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

const SESSIONS_DIR = path.join(process.cwd(), 'wa-sessions')

const silentLogger: any = {
  level: 'silent',
  child: () => silentLogger,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

async function setStatus(accountId: string, data: Partial<{ status: string; qr: string | null; phone: string | null; lastError: string | null; connectedAt: Date | null }>) {
  await prisma.whatsappAccount.update({ where: { id: accountId }, data }).catch(() => {})
}

/** Inicia (ou reinicia) a conexão de uma conta de WhatsApp. */
export async function startSession(accountId: string): Promise<void> {
  if (sessions.get(accountId)?.status === 'connected') return

  // imports dinâmicos — só carregam no servidor, quando necessário
  const baileys = await import('@whiskeysockets/baileys')
  const makeWASocket = (baileys.default ?? (baileys as any).makeWASocket) as any
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys as any
  const { Boom } = await import('@hapi/boom')

  const dir = path.join(SESSIONS_DIR, accountId)
  fs.mkdirSync(dir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: silentLogger,
    browser: ['KeroSolar CRM', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
  })

  sessions.set(accountId, { sock, status: 'connecting', qr: null, phone: null })
  await setStatus(accountId, { status: 'connecting', qr: null, lastError: null })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u: any) => {
    const { connection, lastDisconnect, qr } = u
    const sess = sessions.get(accountId)

    if (qr && sess) {
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
      const loggedOut = code === DisconnectReason.loggedOut
      sessions.delete(accountId)
      if (loggedOut) {
        // desconectou de vez — limpa credenciais
        fs.rmSync(dir, { recursive: true, force: true })
        await setStatus(accountId, { status: 'disconnected', qr: null, phone: null, connectedAt: null })
      } else {
        await setStatus(accountId, { status: 'disconnected', qr: null, lastError: `close (${code})` })
        // reconecta automaticamente
        setTimeout(() => startSession(accountId).catch(() => {}), 3000)
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
