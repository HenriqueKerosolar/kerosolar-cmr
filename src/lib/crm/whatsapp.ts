import 'server-only'
import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { ingestMessage } from './engine'
import { loadAiConfig, transcribeAudio } from './ai'
import { numeroNaLista } from './lists'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Sessões Baileys vivem no processo do servidor. Guardamos num global pra
// sobreviver ao Hot Reload do Next em desenvolvimento.
type Session = { sock: any; status: string; qr: string | null; phone: string | null }
const g = globalThis as unknown as { __waSessions?: Map<string, Session>; __waSeenMsgs?: Set<string>; __waSentByCrm?: Set<string>; __waChains?: Map<string, Promise<unknown>> }
const sessions: Map<string, Session> = (g.__waSessions ??= new Map())

// 🔒 FILA POR CONVERSA: processa UMA mensagem por vez por número (jid). Sem isso, 2 mensagens
// que chegam quase juntas (ex.: "Olá" + "Oi") são processadas em paralelo e cada uma vê
// "ainda não respondi" → manda a saudação 2-3x. A fila garante ordem e evita duplicação.
const chains: Map<string, Promise<unknown>> = (g.__waChains ??= new Map())
function serialPorJid(jid: string, fn: () => Promise<void>): Promise<void> {
  const prev = chains.get(jid) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  chains.set(jid, next)
  next.finally(() => { if (chains.get(jid) === next) chains.delete(jid) })
  return next
}

// Dedup em memória: IDs de mensagens já processadas (evita resposta duplicada
// quando o Baileys dispara messages.upsert 2x para a mesma mensagem).
const seenMsgs: Set<string> = (g.__waSeenMsgs ??= new Set())

// IDs de mensagens que o PRÓPRIO CRM enviou (via sendText/sendMedia). Quando elas
// voltam como "fromMe" no upsert, ignoramos — assim só capturamos o que o operador
// digitou DIRETO no app do WhatsApp (essas sim são registradas no CRM).
const sentByCrm: Set<string> = (g.__waSentByCrm ??= new Set())
function markSentByCrm(id?: string) {
  if (!id) return
  sentByCrm.add(id)
  if (sentByCrm.size > 1000) { for (const x of sentByCrm) { sentByCrm.delete(x); if (sentByCrm.size <= 800) break } }
}

// Em produção Railway usa volume persistente em /data; em dev usa pasta local
const SESSIONS_DIR = fs.existsSync('/data')
  ? '/data/wa-sessions'
  : path.join(process.cwd(), 'wa-sessions')
const UPLOADS_DIR = fs.existsSync('/data')
  ? '/data/uploads'
  : path.join(process.cwd(), 'uploads')

/** Salva um anexo recebido do cliente e devolve a URL pública (servida por /api/uploads/[name]). */
function salvarMidiaRecebida(buffer: Buffer, ext: string): string | null {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    const safeExt = (ext || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
    const name = `in_${Date.now()}_${Math.round(buffer.length % 100000)}${safeExt.startsWith('.') ? safeExt : '.' + safeExt}`
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer)
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
    return `${base}/api/uploads/${name}`
  } catch (e) {
    console.error('[wa] salvarMidiaRecebida erro:', e)
    return null
  }
}

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
      // 'notify'  = mensagens novas em tempo real.
      // 'append'  = mensagens reentregues após reconexão (ex.: chegaram enquanto o deploy
      //             reiniciava o servidor). Precisamos processá-las pra NÃO PERDER lead —
      //             mas só as RECENTES (últimas 12h), pra não "ressuscitar" histórico antigo
      //             numa sincronização. A dedup (memória + banco) evita resposta duplicada.
      const isNotify = ev.type === 'notify'
      const isAppend = ev.type === 'append'
      if (!isNotify && !isAppend) return
      const cutoff = Date.now() / 1000 - 12 * 60 * 60 // 12h atrás (messageTimestamp é em segundos)
      for (const msg of ev.messages) {
        if (isAppend) {
          const tsRaw = msg.messageTimestamp
          const ts = typeof tsRaw === 'number' ? tsRaw : (tsRaw?.toNumber ? tsRaw.toNumber() : Number(tsRaw) || 0)
          if (ts && ts < cutoff) continue // histórico antigo → ignora
        }
        // FILA por conversa: serializa o processamento por número (evita saudação duplicada)
        const jidKey = msg.key?.remoteJid || 'sem-jid'
        await serialPorJid(jidKey, () => handleIncoming(accountId, msg).catch((e) => console.error('[wa incoming]', e)))
      }
    })

    // Recibo de leitura (✓✓ azul): marca nossas mensagens como "lidas" pra métrica de visualizado.
    sock.ev.on('messages.update', async (updates: any[]) => {
      for (const u of updates) {
        const st = u.update?.status
        const lido = st === 4 || st === 5 || st === 'READ' || st === 'PLAYED'
        if (lido && u.key?.id) {
          await prisma.message.updateMany({
            where: { externalId: u.key.id, direction: 'outbound', readAt: null },
            data: { readAt: new Date() },
          }).catch(() => {})
        }
      }
    })
  } catch (e) {
    console.error('[wa] startSession error:', e)
    sessions.delete(accountId)
    await setStatus(accountId, { status: 'disconnected', qr: null, lastError: 'Erro interno ao iniciar sessão' }).catch(() => {})
  }
}

/**
 * Resolve o número REAL (telefone) de uma mensagem. Quando o JID é @lid (privacidade / anúncios
 * da Meta), o WhatsApp NÃO manda o telefone direto — o que criava CONTATOS DUPLICADOS (um pelo
 * número, outro pelo @lid). Aqui usamos o `remoteJidAlt` que o Baileys 7 fornece (o JID de
 * telefone), com fallback no mapeamento LID→PN do Baileys. Assim @lid e telefone caem no MESMO
 * contato. Sem resolução possível → mantém o número do @lid (comportamento antigo, sem quebrar).
 */
async function resolverNumeroReal(accountId: string, msg: any): Promise<string> {
  const jid: string = msg.key?.remoteJid || ''
  if (!jid.endsWith('@lid')) return jid.split('@')[0]
  // 1) remoteJidAlt na própria mensagem (telefone real) — mais confiável
  const alt: string = msg.key?.remoteJidAlt || ''
  if (alt.includes('@s.whatsapp.net')) return alt.split('@')[0]
  // 2) fallback: mapeamento LID→PN do Baileys
  try {
    const sock = sessions.get(accountId)?.sock as any
    const pn: string | null = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid)
    if (pn) return String(pn).split('@')[0]
  } catch { /* sem mapeamento → mantém o @lid */ }
  // 3) sem resolução → mantém o número do @lid
  return jid.split('@')[0]
}

async function handleIncoming(accountId: string, msg: any) {
  const jid: string = msg.key.remoteJid || ''
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return // ignora grupos/status

  // Número REAL (resolve @lid → telefone) — usado p/ casar o contato e evitar duplicatas.
  const phone = await resolverNumeroReal(accountId, msg)

  // BLOCK LIST: ignora COMPLETAMENTE quem está na lista de "não receber" (não processa, não responde)
  if (!msg.key.fromMe && await numeroNaLista(phone, 'no_receive')) return

  // Mensagem enviada por NÓS (fromMe).
  if (msg.key.fromMe) {
    // Se foi o próprio CRM que mandou (IA/automação), já está salva → ignora.
    if (msg.key?.id && sentByCrm.has(msg.key.id)) return
    // Senão, é o OPERADOR respondendo direto pelo app do WhatsApp → registra no CRM
    // (mostra a resposta aqui e salva os arquivos). NÃO desliga a IA.
    try { await registrarMensagemOperador(accountId, msg, jid) } catch (e) { console.error('[wa fromMe]', e) }
    return
  }

  // Cliente apagou uma mensagem ("apagar para todos"). NÃO removemos nada do nosso
  // banco — só marcamos a mensagem original como apagada, mantendo o conteúdo visível.
  const proto = msg.message?.protocolMessage
  if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
    const deletedId: string | undefined = proto.key?.id
    if (deletedId) {
      try {
        const orig = await prisma.message.findFirst({ where: { externalId: deletedId } })
        if (orig && !orig.content.startsWith('🚫')) {
          await prisma.message.update({
            where: { id: orig.id },
            data: { content: `🚫 (cliente apagou esta mensagem) ${orig.content}` },
          })
          console.log('[wa revoke] mensagem marcada como apagada pelo cliente:', deletedId)
        }
      } catch (e) { console.error('[wa revoke]', e) }
    }
    return
  }

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
  // Anexo do cliente salvo para visualização no chat
  let mediaUrl: string | undefined
  let mediaType: 'image' | 'video' | 'document' | undefined

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
        // Guarda o PDF para o operador visualizar no chat
        mediaUrl = salvarMidiaRecebida(buffer, '.pdf') ?? undefined
        mediaType = 'document'
        // Extrai texto do PDF com unpdf (serverless — sem worker nativo, funciona no Railway)
        let pdfText = ''
        try {
          const { extractText, getDocumentProxy } = await import('unpdf')
          const pdf = await getDocumentProxy(new Uint8Array(buffer))
          const { text: pdfRaw } = await extractText(pdf, { mergePages: true })
          pdfText = (Array.isArray(pdfRaw) ? pdfRaw.join('\n') : pdfRaw ?? '').trim().slice(0, 3000)
          console.log('[wa pdf] extraído', pdfText.length, 'chars')
        } catch (e) {
          console.error('[wa pdf] erro:', e)
        }
        if (pdfText) {
          const { parseBillText, isBillPdf } = await import('./pdf-utils')
          const summary = parseBillText(pdfText)
          const isBill = isBillPdf(summary)
          console.log('[wa pdf]', isBill ? 'conta de luz' : 'documento', '—', summary.replace(/\n/g, ' | '))
          if (isBill) {
            // SÓ o resumo estruturado — NÃO incluir o texto bruto (código de barras e
            // linha digitável confundem a extração de consumo e geram valores absurdos)
            text = `Segue minha conta de luz (PDF):\n\n${summary}\n\nIMPORTANTE: use o consumo em kWh para o cálculo do sistema.`
            displayText = '📄 Conta de luz enviada (PDF)'
          } else {
            text = `Segue um documento PDF. Leia o conteúdo abaixo e responda qualquer dúvida sobre ele:\n\n${pdfText}`
            displayText = '📄 Documento enviado (PDF)'
          }
        } else {
          // PDF sem texto extraível (provavelmente escaneado/imagem) → instrui a IA
          text = '[O cliente enviou um PDF que não pôde ser lido automaticamente. NUNCA peça senha (não usamos senha). Se ele ainda não tem orçamento, peça gentilmente o consumo médio em kWh ou o valor médio da conta, ou que reenvie como FOTO. Se já tem orçamento, siga normalmente.]'
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
      const mime = msg.message.imageMessage?.mimetype?.split(';')[0] || 'image/jpeg'
      imageBase64 = buffer.toString('base64')
      imageMediaType = mime
      // Guarda a foto para o operador visualizar no chat
      const imgExt = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg'
      mediaUrl = salvarMidiaRecebida(buffer, imgExt) ?? undefined
      mediaType = 'image'
      if (!displayText) displayText = '📷 Foto enviada'
    } catch (e) {
      console.error('[wa image]', e)
    }
  }

  // Sem texto E sem imagem → nada a processar
  if (!text.trim() && !imageBase64) return

  // `phone` já resolvido no topo (resolve @lid → telefone real). chatJid continua o JID original
  // (inclusive @lid) pra responder no lugar certo; o contato casa pelo telefone real (sem duplicar).
  const name = msg.pushName || null

  // Descobre o funil de destino: primeiro vínculo deste número, senão o padrão
  const link = await prisma.whatsappAccountPipeline.findFirst({ where: { accountId } })
  const pipelineId = link?.pipelineId

  const result = await ingestMessage({
    channel: 'whatsapp',
    externalId: phone,
    chatJid: jid,
    text: text.trim(),
    displayText,
    name,
    phone,
    accountId,
    pipelineId,
    externalMessageId: msg.key.id,
    imageBase64,
    imageMediaType,
    mediaUrl,
    mediaType,
  })

  // Se a IA respondeu, envia de volta pelo WhatsApp
  if (result.reply) {
    await sendText(accountId, jid, result.reply).catch((e) => console.error('[wa send]', e))
  }
}

/** Registra no CRM uma mensagem que o OPERADOR enviou DIRETO pelo app do WhatsApp.
 *  Mostra a resposta aqui (como "👤 Você") e salva os arquivos. NÃO desliga a IA. */
async function registrarMensagemOperador(accountId: string, msg: any, jid: string) {
  const m = msg.message || {}
  let text: string =
    m.conversation || m.extendedTextMessage?.text ||
    m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || ''
  const textoDigitado = text  // texto REAL digitado pelo operador (sem placeholder de mídia)

  let mediaUrl: string | undefined
  let mediaType: 'image' | 'video' | 'document' | undefined

  const isImage = !!m.imageMessage, isVideo = !!m.videoMessage, isDoc = !!m.documentMessage
  const isAudio = !!(m.audioMessage || m.pttMessage)
  if (isImage || isVideo || isDoc || isAudio) {
    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys') as any
      const sess = sessions.get(accountId)
      const buffer: Buffer = await downloadMediaMessage(msg, 'buffer', {}, sess ? { reuploadRequest: sess.sock.updateMediaMessage } : {})
      let ext = '.bin'
      if (isImage) { const mt = m.imageMessage?.mimetype || ''; ext = mt.includes('png') ? '.png' : mt.includes('webp') ? '.webp' : '.jpg'; mediaType = 'image' }
      else if (isVideo) { ext = '.mp4'; mediaType = 'video' }
      else if (isAudio) { ext = '.ogg'; mediaType = 'document' }
      else { const fn = m.documentMessage?.fileName || ''; const dot = fn.lastIndexOf('.'); ext = dot >= 0 ? fn.slice(dot) : (m.documentMessage?.mimetype?.includes('pdf') ? '.pdf' : '.bin'); mediaType = 'document' }
      mediaUrl = salvarMidiaRecebida(buffer, ext) ?? undefined
      if (!text) text = isImage ? '📷 Foto enviada' : isVideo ? '🎥 Vídeo enviado' : isAudio ? '🎤 Áudio enviado' : '📎 Documento enviado'
    } catch (e) { console.error('[wa fromMe media]', e) }
  }

  if (!text && !mediaUrl) return // nada a registrar (edição/reação/etc.)

  const phone = await resolverNumeroReal(accountId, msg)  // resolve @lid → telefone real (evita duplicar)
  let contact = await prisma.contact.findFirst({ where: { OR: [{ phone }, { whatsappId: phone }] } })
  if (!contact) contact = await prisma.contact.create({ data: { phone, whatsappId: phone } })

  let conversation = await prisma.conversation.findFirst({ where: { channel: 'whatsapp', contactId: contact.id }, orderBy: { lastMessageAt: 'desc' } })
  if (!conversation) {
    // operador iniciou uma conversa nova pelo app → cria lead na 1ª etapa pra ficar registrado
    const pipeline = await prisma.pipeline.findFirst({ orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' }, take: 1 } } })
    const stageId = pipeline?.stages?.[0]?.id
    const lead = pipeline && stageId ? await prisma.lead.create({ data: { title: contact.name || phone, pipelineId: pipeline.id, stageId, contactId: contact.id, source: 'whatsapp' } }) : null
    conversation = await prisma.conversation.create({ data: { channel: 'whatsapp', contactId: contact.id, leadId: lead?.id ?? null, externalId: phone, chatJid: jid, accountId } })
  }

  // dedup: não grava 2x a mesma mensagem
  if (msg.key?.id) {
    const ja = await prisma.message.findFirst({ where: { conversationId: conversation.id, externalId: msg.key.id }, select: { id: true } })
    if (ja) return
  }

  // 🧮 COMANDO DO OPERADOR pelo app: "minha indicação é XXXX kWh" → calcula e envia o orçamento.
  // (O cliente já recebeu o texto que você digitou no app; aqui não registramos o comando no CRM
  //  e mandamos o orçamento calculado.)
  if (textoDigitado.trim() && conversation.leadId) {
    const { comandoIndicacaoKwh } = await import('./flow')
    if (await comandoIndicacaoKwh(conversation.leadId, conversation.id, textoDigitado)) return
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id, direction: 'outbound', senderType: 'human',
      content: text || '[arquivo]', externalId: msg.key?.id ?? null,
      mediaUrl: mediaUrl ?? null, mediaType: mediaType ?? null,
    },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })
  if (conversation.leadId) await prisma.lead.update({ where: { id: conversation.leadId }, data: { lastMessageAt: new Date() } }).catch(() => {})

  // 📚 Aprende com a resposta do operador (só texto digitado de verdade, não placeholder de mídia)
  if (textoDigitado.trim().length >= 8) {
    const { aprenderResposta } = await import('./learning')
    aprenderResposta(conversation.id, textoDigitado).catch(() => {})
  }
}

/** Envia mensagem de texto. Devolve o ID da mensagem no WhatsApp (pra rastrear "lido"). */
export async function sendText(accountId: string, jid: string, text: string): Promise<string | null> {
  const sess = sessions.get(accountId)
  if (!sess || sess.status !== 'connected') throw new Error('WhatsApp não conectado.')
  // BLACK LIST: nunca envia pra quem está na lista de "não enviar"
  if (await numeroNaLista(jid.split('@')[0], 'no_send')) { console.log('[wa] black list — envio bloqueado:', jid); return null }
  const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  const sent = await sess.sock.sendMessage(fullJid, { text })
  markSentByCrm(sent?.key?.id)
  return sent?.key?.id ?? null
}

/** Envia mídia (imagem, vídeo, documento) por URL. */
export async function sendMedia(accountId: string, jid: string, opts: { url: string; type: 'image' | 'video' | 'document'; caption?: string; fileName?: string }): Promise<string | null> {
  const sess = sessions.get(accountId)
  if (!sess || sess.status !== 'connected') throw new Error('WhatsApp não conectado.')
  if (await numeroNaLista(jid.split('@')[0], 'no_send')) { console.log('[wa] black list — envio (mídia) bloqueado:', jid); return null }
  const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  const payload: any =
    opts.type === 'image'    ? { image: { url: opts.url }, caption: opts.caption } :
    opts.type === 'video'    ? { video: { url: opts.url }, caption: opts.caption } :
                               { document: { url: opts.url }, fileName: opts.fileName ?? 'arquivo', caption: opts.caption }
  const sent = await sess.sock.sendMessage(fullJid, payload)
  markSentByCrm(sent?.key?.id)
  return sent?.key?.id ?? null
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
 * No startup, reconecta TODA conta que tenha sessão salva no disco
 * (creds.json), independente do status no banco — assim uma conta que
 * caiu para "qr"/"connecting" mas ainda tem credenciais volta sozinha,
 * sem precisar escanear o QR de novo. Contas sem credenciais são
 * resetadas para "disconnected".
 * Chamado via instrumentation.ts.
 */
export async function reconnectAllOnStartup(): Promise<void> {
  try {
    const accounts = await prisma.whatsappAccount.findMany({
      where: { status: { in: ['connected', 'connecting', 'qr'] } },
    })
    let reconectar = 0
    for (const acc of accounts) {
      const temCreds = fs.existsSync(path.join(SESSIONS_DIR, acc.id, 'creds.json'))
      if (temCreds) {
        reconectar++
        await new Promise((r) => setTimeout(r, 2000))
        console.log(`[wa] reconectando ${acc.id} (sessão salva encontrada)`)
        startSession(acc.id).catch((e) => console.error(`[wa] startup reconnect ${acc.id}:`, e))
      } else {
        // sem credenciais salvas → não dá pra reconectar sem QR
        await setStatus(acc.id, { status: 'disconnected', qr: null })
        console.log(`[wa] ${acc.id} sem sessão salva — resetado para disconnected`)
      }
    }
    if (reconectar > 0) console.log(`[wa] Reconectando ${reconectar} conta(s) no startup…`)
  } catch (e) {
    console.error('[wa] reconnectAllOnStartup error:', e)
  }
}
