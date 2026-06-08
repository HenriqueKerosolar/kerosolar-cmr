import 'server-only'
import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { ingestMessage } from './engine'
import { loadAiConfig, transcribeAudio } from './ai'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Sessões Baileys vivem no processo do servidor. Guardamos num global pra
// sobreviver ao Hot Reload do Next em desenvolvimento.
type Session = { sock: any; status: string; qr: string | null; phone: string | null }
const g = globalThis as unknown as { __waSessions?: Map<string, Session> }
const sessions: Map<string, Session> = (g.__waSessions ??= new Map())

// Em produção Railway usa volume persistente em /data; em dev usa pasta local
const SESSIONS_DIR = fs.existsSync('/data')
  ? '/data/wa-sessions'
  : path.join(process.cwd(), 'wa-sessions')

const silentLogger: any = {
  level: 'error',
  child: () => silentLogger,
  trace() {}, debug() {}, info() {}, warn() {},
  error(...args: unknown[]) { console.error('[baileys]', ...args) },
  fatal(...args: unknown[]) { console.error('[baileys fatal]', ...args) },
}

async function setStatus(accountId: string, data: Partial<{ status: string; qr: string | null; phone: string | null; lastError: string | null; connectedAt: Date | null }>) {
  await prisma.whatsappAccount.update({ where: { id: accountId }, data }).catch(() => {})
}

/** Inicia (ou reinicia) a conexão de uma conta de WhatsApp. */
export async function startSession(accountId: string): Promise<void> {
  // Previne sessões duplas: se já existe qualquer sessão ativa (connecting / qr / connected), ignora
  if (sessions.has(accountId)) {
    console.log(`[wa] startSession ${accountId} — sessão já ativa (${sessions.get(accountId)?.status}), ignorando`)
    return
  }

  console.log('[wa] startSession', accountId)

  // imports dinâmicos — só carregam no servidor, quando necessário
  const baileys = await import('@whiskeysockets/baileys')
  const makeWASocket = (baileys.default ?? (baileys as any).makeWASocket) as any
  const { useMultiFileAuthState, DisconnectReason, Browsers,
          fetchLatestWaWebVersion, fetchLatestBaileysVersion } = baileys as any
  const { Boom } = await import('@hapi/boom')

  const dir = path.join(SESSIONS_DIR, accountId)
  fs.mkdirSync(dir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  // fetchLatestWaWebVersion busca a versão atual direto dos servidores do WhatsApp (mais confiável)
  const { version } = await (fetchLatestWaWebVersion ?? fetchLatestBaileysVersion)().catch((e: unknown) => {
    console.error('[wa] fetchVersion failed:', e)
    return { version: undefined }
  })
  console.log('[wa] using version', version)

  // Reserva o slot ANTES de criar o socket para evitar race condition
  sessions.set(accountId, { sock: null, status: 'connecting', qr: null, phone: null })
  await setStatus(accountId, { status: 'connecting', qr: null, lastError: null })

  const browserConfig = Browsers?.macOS?.('Chrome') ?? ['Mac OS X', 'Chrome', '130.0.0']

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: silentLogger,
    browser: browserConfig,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 30000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 2,
  })
  // Atualiza o slot com o socket real
  const sessRef = sessions.get(accountId)
  if (sessRef) sessRef.sock = sock

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u: any) => {
    const { connection, lastDisconnect, qr } = u
    const sess = sessions.get(accountId)

    if (qr && sess) {
      console.log('[wa] QR received for', accountId)
      const dataUrl = await QRCode.toDataURL(qr).catch(() => null)
      sess.qr = dataUrl
      sess.status = 'qr'
      await setStatus(accountId, { status: 'qr', qr: dataUrl })
    }

    if (connection === 'open' && sess) {
      sess.status = 'connected'
      sess.qr = null
      const phone = (sock.user?.id || '').split(':')[0].split('@')[0] || null
      sess.phone = phone
      await setStatus(accountId, { status: 'connected', qr: null, phone, connectedAt: new Date(), lastError: null })
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as InstanceType<typeof Boom>)?.output?.statusCode
      const loggedOut   = code === DisconnectReason.loggedOut
      // credenciais ruins / servidor rejeitou → limpa sessão, não tenta reconectar em loop
      const badSession  = code === DisconnectReason.badSession
        || code === 401  // unauthorized
        || code === 408  // stream timeout (credencial inválida)
        || code === 428  // connection failed / stream error
        || code === 440  // kicked
        || code === 515  // restart required (versão desatualizada)
      sessions.delete(accountId)
      if (loggedOut || badSession) {
        console.log(`[wa] sessão inválida (code ${code}) — limpando credenciais de ${accountId}`)
        fs.rmSync(dir, { recursive: true, force: true })
        await setStatus(accountId, { status: 'disconnected', qr: null, phone: null, connectedAt: null, lastError: badSession ? `Sessão rejeitada (${code}) — reconecte manualmente` : null })
      } else {
        await setStatus(accountId, { status: 'disconnected', qr: null, lastError: `close (${code})` })
        // reconecta automaticamente só em quedas de rede (não em rejeição de credencial)
        setTimeout(() => startSession(accountId).catch(() => {}), 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async (ev: any) => {
    if (ev.type !== 'notify') return
    for (const msg of ev.messages) {
      try { await handleIncoming(accountId, msg) } catch (e) { console.error('[wa incoming]', e) }
    }
  })
}

async function handleIncoming(accountId: string, msg: any) {
  if (msg.key.fromMe) return
  const jid: string = msg.key.remoteJid || ''
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return // ignora grupos/status

  let text: string =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''

  let displayText: string | undefined

  // Áudio / PTT → transcreve via OpenAI Whisper
  const isAudio = !!(msg.message?.audioMessage || msg.message?.pttMessage)
  if (isAudio) {
    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys') as any
      const sess = sessions.get(accountId)
      const buffer: Buffer = await downloadMediaMessage(
        msg, 'buffer', {},
        sess ? { reuploadRequest: sess.sock.updateMediaMessage } : {},
      )
      const cfg = await loadAiConfig()
      const transcript = await transcribeAudio(cfg, buffer, 'audio/ogg')
      if (transcript) {
        text = transcript
        displayText = `🎤 "${transcript}"`
      }
    } catch (e) {
      console.error('[wa audio]', e)
    }
  }

  // Documento PDF → extrai texto e detecta se é conta de luz ou outro documento
  const isDoc = !!(msg.message?.documentMessage)
  if (isDoc && !text.trim()) {
    try {
      const docMsg = msg.message.documentMessage
      const mimeType: string = docMsg?.mimetype ?? ''
      if (mimeType === 'application/pdf' || docMsg?.fileName?.toLowerCase().endsWith('.pdf')) {
        const { downloadMediaMessage } = await import('@whiskeysockets/baileys') as any
        const sess = sessions.get(accountId)
        const buffer: Buffer = await downloadMediaMessage(
          msg, 'buffer', {},
          sess ? { reuploadRequest: sess.sock.updateMediaMessage } : {},
        )
        const { execFile } = await import('child_process')
        const { writeFile, unlink } = await import('fs/promises')
        const { tmpdir } = await import('os')
        const { join } = await import('path')
        const tmp = join(tmpdir(), `wa_doc_${Date.now()}.pdf`)
        await writeFile(tmp, buffer)
        const pdfText: string = await new Promise((resolve) => {
          execFile('pdftotext', [tmp, '-'], (err, stdout) => {
            unlink(tmp).catch(() => {})
            resolve(err || !stdout.trim() ? '' : stdout.trim().slice(0, 3000))
          })
        })
        if (pdfText) {
          const { parseBillText, isBillPdf } = await import('./pdf-utils')
          const summary = parseBillText(pdfText)
          const isBill = isBillPdf(summary)
          if (isBill) {
            text = `Segue minha conta de luz (PDF):\n\n${summary}\n\nIMPORTANTE: use o consumo em kWh para o cálculo do sistema.\n\n${pdfText.slice(0, 1500)}`
            displayText = '📄 Conta de luz enviada (PDF)'
          } else {
            text = `Segue um documento PDF. Leia o conteúdo abaixo e responda qualquer dúvida sobre ele:\n\n${pdfText}`
            displayText = '📄 Documento enviado (PDF)'
          }
        }
      }
    } catch (e) {
      console.error('[wa doc]', e)
    }
  }

  if (!text.trim()) return

  const phone = jid.split('@')[0]
  const name = msg.pushName || null

  // Descobre o funil de destino: primeiro vínculo deste número, senão o padrão
  const link = await prisma.whatsappAccountPipeline.findFirst({ where: { accountId } })
  const pipelineId = link?.pipelineId

  const result = await ingestMessage({
    channel: 'whatsapp',
    externalId: phone,
    text: text.trim(),
    displayText,
    name,
    phone,
    accountId,
    pipelineId,
    externalMessageId: msg.key.id,
  })

  // Se a IA respondeu, envia de volta pelo WhatsApp
  if (result.reply) {
    await sendText(accountId, jid, result.reply).catch((e) => console.error('[wa send]', e))
  }
}

/** Envia mensagem de texto. */
export async function sendText(accountId: string, jid: string, text: string): Promise<void> {
  const sess = sessions.get(accountId)
  if (!sess || sess.status !== 'connected') throw new Error('WhatsApp não conectado.')
  const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  await sess.sock.sendMessage(fullJid, { text })
}

/** Envia mídia (imagem, vídeo, documento) por URL. */
export async function sendMedia(accountId: string, jid: string, opts: { url: string; type: 'image' | 'video' | 'document'; caption?: string; fileName?: string }): Promise<void> {
  const sess = sessions.get(accountId)
  if (!sess || sess.status !== 'connected') throw new Error('WhatsApp não conectado.')
  const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  const payload: any =
    opts.type === 'image'    ? { image: { url: opts.url }, caption: opts.caption } :
    opts.type === 'video'    ? { video: { url: opts.url }, caption: opts.caption } :
                               { document: { url: opts.url }, fileName: opts.fileName ?? 'arquivo', caption: opts.caption }
  await sess.sock.sendMessage(fullJid, payload)
}

export async function disconnect(accountId: string): Promise<void> {
  const sess = sessions.get(accountId)
  if (sess) { try { await sess.sock.logout() } catch {} sessions.delete(accountId) }
  const dir = path.join(SESSIONS_DIR, accountId)
  fs.rmSync(dir, { recursive: true, force: true })
  await setStatus(accountId, { status: 'disconnected', qr: null, phone: null, connectedAt: null })
}

export function getLiveStatus(accountId: string): { status: string; qr: string | null; phone: string | null } | null {
  const s = sessions.get(accountId)
  return s ? { status: s.status, qr: s.qr, phone: s.phone } : null
}

/**
 * No startup:
 * - Contas "connected" → tenta reconectar (sessão persistida em disco)
 * - Contas "connecting" / "qr" → reseta para "disconnected" (QR expirou, usuário precisa reconectar manualmente)
 * Chamado via instrumentation.ts.
 */
export async function reconnectAllOnStartup(): Promise<void> {
  try {
    // Reseta contas presas em connecting/qr (QR expirado, não vale reconectar automaticamente)
    const stuck = await prisma.whatsappAccount.updateMany({
      where: { status: { in: ['connecting', 'qr'] } },
      data: { status: 'disconnected', qr: null },
    })
    if (stuck.count > 0) {
      console.log(`[wa] ${stuck.count} conta(s) em qr/connecting resetadas para disconnected`)
    }

    // Só tenta reconectar as que estavam efetivamente conectadas
    const accounts = await prisma.whatsappAccount.findMany({
      where: { status: 'connected' },
    })
    if (accounts.length === 0) return
    console.log(`[wa] Reconectando ${accounts.length} conta(s) no startup…`)
    for (const acc of accounts) {
      // pequeno delay entre cada conta para não sobrecarregar
      await new Promise((r) => setTimeout(r, 2000))
      startSession(acc.id).catch((e) => console.error(`[wa] startup reconnect ${acc.id}:`, e))
    }
  } catch (e) {
    console.error('[wa] reconnectAllOnStartup error:', e)
  }
}
