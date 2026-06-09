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
const g = globalThis as unknown as { __waSessions?: Map<string, Session>; __waSeenMsgs?: Set<string> }
const sessions: Map<string, Session> = (g.__waSessions ??= new Map())

// Dedup em memória: IDs de mensagens já processadas (evita resposta duplicada
// quando o Baileys dispara messages.upsert 2x para a mesma mensagem).
const seenMsgs: Set<string> = (g.__waSeenMsgs ??= new Set())

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
  // Previne sessões duplas — reserva o slot ANTES de qualquer await
  // (test-and-set atômico: sem slot reservado aqui, um segundo call concorrente
  //  passa o check durante os awaits de import/multiFileAuthState/fetchVersion)
  if (sessions.has(accountId)) {
    console.log(`[wa] startSession ${accountId} — sessão já ativa (${sessions.get(accountId)?.status}), ignorando`)
    return
  }
  sessions.set(accountId, { sock: null, status: 'connecting', qr: null, phone: null })

  console.log('[wa] startSession', accountId)

  try {
    await setStatus(accountId, { status: 'connecting', qr: null, lastError: null })

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

    // Proxy opcional — define PROXY_URL no Railway para rotear pelo IP residencial
    // Formatos aceitos:
    //   HTTP/HTTPS : http://user:pass@host:port
    //   SOCKS5     : socks5://user:pass@host:port
    let proxyAgent: import('http').Agent | undefined
    const proxyUrl = process.env.PROXY_URL
    if (proxyUrl) {
      try {
        if (proxyUrl.startsWith('socks')) {
          const { SocksProxyAgent } = await import('socks-proxy-agent')
          proxyAgent = new SocksProxyAgent(proxyUrl)
        } else {
          const { HttpsProxyAgent } = await import('https-proxy-agent')
          proxyAgent = new HttpsProxyAgent(proxyUrl)
        }
        console.log('[wa] usando proxy:', proxyUrl.replace(/:([^@:]+)@/, ':***@'))
      } catch (e) {
        console.error('[wa] falha ao criar proxy agent:', e)
      }
    }

    const browserConfig = Browsers?.macOS?.('Chrome') ?? ['Mac OS X', 'Chrome', '130.0.0']

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: browserConfig,
      markOnlineOnConnect: false,
      connectTimeoutMs: 25000,
      defaultQueryTimeoutMs: 25000,
      keepAliveIntervalMs: 15000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 2,
      ...(proxyAgent ? { agent: proxyAgent, fetchAgent: proxyAgent } : {}),
    })
    // Atualiza o slot com o socket real
    const sessRef = sessions.get(accountId)
    if (sessRef) sessRef.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (u: any) => {
      const { connection, lastDisconnect, qr } = u
      if (connection || qr) {
        console.log(`[wa] ${accountId} →`, connection || 'qr', qr ? '(qr)' : '', (lastDisconnect?.error as any)?.output?.statusCode ?? '')
      }
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
        sessions.delete(accountId)

        // 515 (restartRequired) é NORMAL — o WhatsApp pede pra reiniciar a conexão
        // logo após gerar o QR / parear. Deve reconectar IMEDIATAMENTE sem limpar creds.
        const restartRequired = code === DisconnectReason.restartRequired || code === 515
        // logout de verdade → apaga credenciais, não reconecta
        const loggedOut = code === DisconnectReason.loggedOut || code === 401
        // outra sessão assumiu o número → não reconecta
        const replaced  = code === DisconnectReason.connectionReplaced || code === 440

        if (restartRequired) {
          console.log(`[wa] restart required (${code}) — reconectando imediatamente, mantendo credenciais`)
          await setStatus(accountId, { status: 'connecting', qr: null })
          setTimeout(() => startSession(accountId).catch(() => {}), 1500)
        } else if (loggedOut) {
          console.log(`[wa] logout (${code}) — limpando credenciais de ${accountId}`)
          fs.rmSync(dir, { recursive: true, force: true })
          await setStatus(accountId, {
            status: 'disconnected', qr: null, phone: null, connectedAt: null,
            lastError: 'Desconectado pelo WhatsApp — reconecte e leia o QR novamente',
          })
        } else if (replaced) {
          console.log(`[wa] conexão substituída (${code}) — outra sessão assumiu o número`)
          await setStatus(accountId, { status: 'disconnected', qr: null, lastError: 'Conexão aberta em outro lugar' })
        } else {
          // queda de rede / timeout → reconecta com delay, mantém credenciais
          console.log(`[wa] close (${code}) — reconectando em 5s`)
          await setStatus(accountId, { status: 'disconnected', qr: null, lastError: `close (${code})` })
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
  } catch (e) {
    console.error('[wa] startSession error:', e)
    sessions.delete(accountId)
    await setStatus(accountId, { status: 'disconnected', qr: null, lastError: 'Erro interno ao iniciar sessão' }).catch(() => {})
  }
}

async function handleIncoming(accountId: string, msg: any) {
  if (msg.key.fromMe) return
  const jid: string = msg.key.remoteJid || ''
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return // ignora grupos/status

  // Dedup em memória por ID da mensagem — barra eventos duplicados do mesmo processo
  const msgId: string | undefined = msg.key?.id
  if (msgId) {
    if (seenMsgs.has(msgId)) { console.log('[wa] msg duplicada ignorada (mem):', msgId); return }
    seenMsgs.add(msgId)
    // limita o tamanho do Set pra não vazar memória (mantém ~os últimos 1000)
    if (seenMsgs.size > 1000) { for (const id of seenMsgs) { seenMsgs.delete(id); if (seenMsgs.size <= 800) break } }
  }

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
        // Extrai texto do PDF com pdf-parse (JS puro — não depende de binário do SO)
        let pdfText = ''
        try {
          const { PDFParse } = await import('pdf-parse') as any
          const parser = new PDFParse({ data: new Uint8Array(buffer) })
          const result = await parser.getText()
          pdfText = (result?.text ?? '').trim().slice(0, 3000)
          await parser.destroy?.().catch?.(() => {})
        } catch (e) {
          console.error('[wa pdf-parse]', e)
        }
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
        } else {
          // PDF sem texto extraível (provavelmente escaneado/imagem) → instrui a IA
          text = '[O cliente enviou um PDF que não pôde ser lido automaticamente. Se ele ainda não tem orçamento, peça gentilmente o consumo médio em kWh ou o valor médio da conta, ou que reenvie como foto. Se já tem orçamento, siga normalmente.]'
          displayText = '📄 PDF enviado (não foi possível ler o conteúdo)'
        }
      }
    } catch (e) {
      console.error('[wa doc]', e)
    }
  }

  // Imagem (foto) → baixa e envia como base64 para a visão da IA ler (conta de luz, anúncio de painéis, etc.)
  let imageBase64: string | undefined
  let imageMediaType: string | undefined
  const isImage = !!msg.message?.imageMessage
  if (isImage) {
    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys') as any
      const sess = sessions.get(accountId)
      const buffer: Buffer = await downloadMediaMessage(
        msg, 'buffer', {},
        sess ? { reuploadRequest: sess.sock.updateMediaMessage } : {},
      )
      imageBase64 = buffer.toString('base64')
      imageMediaType = msg.message.imageMessage?.mimetype?.split(';')[0] || 'image/jpeg'
      if (!displayText) displayText = '📷 Foto enviada'
    } catch (e) {
      console.error('[wa image]', e)
    }
  }

  // Sem texto E sem imagem → nada a processar
  if (!text.trim() && !imageBase64) return

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
    imageBase64,
    imageMediaType,
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
