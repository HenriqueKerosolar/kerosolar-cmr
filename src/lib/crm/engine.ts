import 'server-only'
import { Prisma } from '@prisma/client'
import type { Channel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { saudacaoAgora, comCumprimento, corrigirCumprimento, horaBrasilia } from './saudacao'
import { runAgent } from './agent'
import type { ChatMessage } from './ai'
import { loadAiConfig, extractBillFromImage } from './ai'

// ─── Funil padrão ─────────────────────────────────────────────────────────────
const DEFAULT_STAGES = [
  { key: 'novo',          name: 'Novo',         color: '#3b82f6' },
  { key: 'qualificando',  name: 'Qualificando', color: '#eab308' },
  { key: 'orcamento',     name: 'Orçamento',    color: '#f97316' },
  { key: 'negociacao',    name: 'Negociação',   color: '#a855f7' },
  { key: 'ganho',         name: 'Ganho',        color: '#22c55e', isWon: true },
  { key: 'perdido',       name: 'Perdido',      color: '#ef4444', isLost: true },
] as const

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export async function ensureDefaultPipeline() {
  let pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { sortOrder: 'asc' } } },
  })
  if (pipeline && pipeline.stages.length) return pipeline

  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { name: 'Funil KeroSolar', isDefault: true },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    })
  }
  await prisma.stage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({
      pipelineId: pipeline!.id,
      name: s.name, color: s.color, sortOrder: i,
      isWon:  'isWon'  in s ? !!s.isWon  : false,
      isLost: 'isLost' in s ? !!s.isLost : false,
    })),
  })
  return prisma.pipeline.findUniqueOrThrow({
    where: { id: pipeline.id },
    include: { stages: { orderBy: { sortOrder: 'asc' } } },
  })
}

const DEFAULT_RETURN_MESSAGE =
  'Que bom que você retornou! 😊 Vamos continuar e tentar resolver suas dúvidas, chegar a um acordo bom para você e resolver o seu problema.'

/** Simula digitação: espera um tempo proporcional ao tamanho da mensagem (700ms + 30ms/caractere, máx 6s). */
const simularDigitacao = (t: string) => new Promise<void>((r) => setTimeout(r, Math.min(6000, 700 + (t?.length ?? 0) * 30)))

/**
 * Verifica (de forma determinística) se a data cai em dia útil no fuso de Brasília.
 * Dia útil = segunda a sexta, exceto feriados nacionais fixos.
 * (LLM não calcula dia da semana de forma confiável; por isso validamos aqui.)
 */
function ehDiaUtil(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
  }).formatToParts(date)
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const dd = parts.find((p) => p.type === 'day')?.value
  const mm = parts.find((p) => p.type === 'month')?.value
  // Feriados nacionais fixos (MM-DD)
  const feriadosFixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']
  if (feriadosFixos.includes(`${mm}-${dd}`)) return false
  return true
}

/** A etapa tem automação configurada? (blocos, chamada, palavra-chave ou inatividade) */
function stageHasAutomation(flow: unknown): boolean {
  const f = flow as { blocks?: unknown[]; openingMessages?: unknown[]; keywordRules?: unknown[]; noReplyMinutes?: number } | null
  if (!f) return false
  return (f.blocks?.length ?? 0) > 0
    || (f.openingMessages?.length ?? 0) > 0
    || (f.keywordRules?.length ?? 0) > 0
    || (f.noReplyMinutes ?? 0) > 0
}

/** Lê a tabela de histórico ("CONSUMO FATURADO": ex. "OUT/26 ------ 493 33") do TEXTO do PDF e devolve
 *  a MÉDIA dos meses. Determinístico — não depende da IA acertar a conta (ela tendia a pegar só o mês
 *  atual). null se achar menos de 3 meses (aí vale a leitura da IA). */
function mediaHistoricoConsumo(texto: string): { media: number; meses: number } | null {
  const re = /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\/\s*(\d{2,4})\b[^\d\n]*(\d{2,5})(?=\D|$)/gi
  const vistos = new Map<string, number>()
  for (const m of texto.matchAll(re)) {
    const chave = `${m[1].toUpperCase()}/${m[2].slice(-2)}`
    const kwh = Number(m[3])
    if (!vistos.has(chave) && kwh >= 30 && kwh <= 50000) vistos.set(chave, kwh)
  }
  if (vistos.size < 3) return null
  const vals = [...vistos.values()]
  return { media: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), meses: vals.length }
}

function channelIdField(ch: Channel): 'whatsappId' | 'instagramId' | 'facebookId' | null {
  if (ch === 'whatsapp')  return 'whatsappId'
  if (ch === 'instagram') return 'instagramId'
  if (ch === 'facebook')  return 'facebookId'
  return null // simulator e webchat → casa por telefone = externalId (id do visitante)
}

export type IngestInput = {
  channel: Channel
  externalId: string
  chatJid?: string               // endereço completo do WhatsApp (ex: ...@lid) pra responder no lugar certo
  text: string
  displayText?: string           // texto exibido no chat (substitui `text` na gravação); usado p/ PDF/imagem
  name?: string | null
  phone?: string | null
  externalMessageId?: string | null
  pipelineId?: string | null
  accountId?: string | null
  imageBase64?: string           // imagem enviada pelo cliente (conta de luz, foto etc.)
  imageMediaType?: string
  pdfBase64?: string             // conta de luz em PDF (scanned/sem texto) → bloco 'document' da Anthropic
  pdfText?: string               // texto extraído do PDF (unpdf) → caminho PRINCIPAL de leitura
  sentAt?: Date | null           // data REAL em que o cliente mandou (timestamp do webhook da Meta)
  foraJanela?: boolean           // mensagem com mais de 24h (reentrega atrasada) → só template, sem IA
  mediaUrl?: string | null       // anexo do cliente salvo (para visualizar no chat)
  mediaType?: 'image' | 'video' | 'document' | 'audio' | null
}

export type IngestResult = {
  contactId: string
  conversationId: string
  leadId: string
  reply: string | null
  aiHandled: boolean
  handoff: boolean
  stage: string
  /** 2ª mensagem a enviar DEPOIS da resposta (ex.: "quer continuar agora ou amanhã?" fora do horário) */
  followUp?: string | null
}

// 🔒 Lock por conversa (serviço com 1 réplica): serializa o processamento de mensagens do MESMO
//    cliente. Evita que dois webhooks simultâneos (foto + "mandei a conta") façam read-modify-write
//    do customFields em paralelo e um APAGUE o orçamento do outro (lost update → IA reperguntava).
const __ingestLocks = new Map<string, Promise<void>>()
export async function ingestMessage(input: IngestInput): Promise<IngestResult> {
  const key = `${input.channel}:${input.externalId}`
  const prev = __ingestLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => { release = r })
  const chained = prev.then(() => mine)
  __ingestLocks.set(key, chained)
  try {
    await prev.catch(() => {})
    return await ingestMessageInner(input)
  } finally {
    release()
    if (__ingestLocks.get(key) === chained) __ingestLocks.delete(key)
  }
}

async function ingestMessageInner(input: IngestInput): Promise<IngestResult> {
  const { channel, externalId } = input
  const isSimulator = channel === 'simulator'   // no simulador: timers desativados para testes
  let text = input.text
  // Funil de destino: o informado (roteamento por canal) ou o padrão
  let pipeline = input.pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: input.pipelineId }, include: { stages: { orderBy: { sortOrder: 'asc' } } } })
    : null
  if (!pipeline || !pipeline.stages.length) pipeline = await ensureDefaultPipeline()
  const firstStage = pipeline.stages[0]

  // 1) Contato
  const idField   = channelIdField(channel)
  const matchPhone = input.phone ?? (idField ? null : externalId)
  let contact =
    (idField ? await prisma.contact.findFirst({ where: { [idField]: externalId } }) : null) ||
    (matchPhone ? await prisma.contact.findFirst({ where: { phone: matchPhone } }) : null)

  // 🔗 ANTI-DUPLICATA por NOME (WhatsApp): se não casou por id/telefone mas JÁ EXISTE um contato
  //    com o MESMO NOME do TIPO OPOSTO (um @lid de anúncio, outro telefone), reaproveita esse
  //    contato em vez de criar duplicado. Só funde lid↔telefone (nunca dois telefones de mesmo
  //    nome) e só com 1 candidato (sem ambiguidade). Resolve o caso anúncio @lid + telefone real.
  if (!contact && channel === 'whatsapp' && (input.name?.trim().length ?? 0) >= 4) {
    const ehLid = (n?: string | null) => !!n && !/^55\d{10,11}$/.test(n)
    const incomingLid = ehLid(externalId)
    const mesmoNome = await prisma.contact.findMany({
      where: { name: { equals: input.name!.trim(), mode: 'insensitive' } },
      select: { id: true, whatsappId: true, phone: true },
    })
    const opostos = mesmoNome.filter((c) => ehLid(c.whatsappId) !== incomingLid)
    if (opostos.length === 1) {
      contact = await prisma.contact.findUnique({ where: { id: opostos[0].id } })
      // chegou pelo TELEFONE e o contato só tinha @lid → grava o telefone real (vira localizável)
      if (contact && !incomingLid) {
        contact = await prisma.contact.update({ where: { id: contact.id }, data: { phone: externalId } }).catch(() => contact)
      }
      if (contact) console.log('[ingest] contato reaproveitado por nome (anti-duplicata @lid/telefone):', input.name)
    }
  }

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        name:  input.name ?? null,
        phone: input.phone ?? (idField ? null : externalId),
        ...(idField ? { [idField]: externalId } : {}),
      },
    })
  } else if (input.name && !contact.name) {
    contact = await prisma.contact.update({ where: { id: contact.id }, data: { name: input.name } })
  }

  // 2) Conversa
  let conversation = await prisma.conversation.findUnique({
    where: { channel_contactId: { channel, contactId: contact.id } },
  })
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { channel, contactId: contact.id, externalId, chatJid: input.chatJid ?? null, accountId: input.accountId ?? null },
    })
  } else {
    // mantém accountId e o endereço completo (chatJid) atualizados — chatJid garante a resposta no JID certo (LID)
    const upd: Record<string, unknown> = {}
    if (input.accountId && conversation.accountId !== input.accountId) upd.accountId = input.accountId
    if (input.chatJid && input.chatJid.includes('@') && conversation.chatJid !== input.chatJid) upd.chatJid = input.chatJid
    if (Object.keys(upd).length) conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: upd })
  }

  // 3) Lead
  let isNewLead = false
  let lead = await prisma.lead.findFirst({
    where: { contactId: contact.id, status: 'open' },
    orderBy: { createdAt: 'desc' },
  })
  if (!lead) {
    isNewLead = true
    lead = await prisma.lead.create({
      data: {
        title:      contact.name ?? `Lead ${channel}`,
        pipelineId: pipeline.id,
        stageId:    firstStage.id,
        contactId:  contact.id,
        source:     channel,
      },
    })
    await prisma.note.create({
      data: { leadId: lead.id, type: 'system', content: `Lead criado via ${channel}.` },
    })
  }
  // Atualiza a conversa: vincula ao lead e ADOTA a conta de origem da mensagem. Assim, quando um
  // contato antigo (Baileys) escreve agora pela API OFICIAL (cloud), as respostas passam a sair
  // pela conta cloud — e não pela conta Baileys antiga (que pode estar morta).
  {
    const updConv: Record<string, unknown> = {}
    if (conversation.leadId !== lead.id) updConv.leadId = lead.id
    if (input.accountId && conversation.accountId !== input.accountId) updConv.accountId = input.accountId
    if (Object.keys(updConv).length) {
      conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: updConv })
    }
  }

  // 3.5) DEDUPLICAÇÃO — evita resposta duplicada quando a MESMA mensagem chega 2x
  // (Baileys reentrega/retransmite, reconexão pós-restart reprocessa offline, evento duplo).
  // Se já existe uma mensagem inbound com este externalMessageId, ignora silenciosamente.
  if (input.externalMessageId) {
    const jaProcessada = await prisma.message.findFirst({
      where: { direction: 'inbound', externalId: input.externalMessageId },
      select: { id: true },
    })
    if (jaProcessada) {
      console.log('[engine] mensagem duplicada ignorada:', input.externalMessageId)
      return {
        contactId: contact.id, conversationId: conversation.id, leadId: lead.id,
        reply: null, aiHandled: false, handoff: false,
        stage: pipeline.stages.find((s) => s.id === lead!.stageId)?.name ?? firstStage.name,
      }
    }
  }

  // 4) Mensagem recebida
  const now = new Date()
  await prisma.message.create({
    data: {
      conversationId: conversation.id, direction: 'inbound', senderType: 'contact',
      content: input.displayText ?? text, externalId: input.externalMessageId ?? null,
      mediaUrl: input.mediaUrl ?? null, mediaType: input.mediaType ?? null,
      // Data REAL em que o cliente mandou (timestamp da Meta) — mensagens reentregues atrasadas
      // ficam com a data certa, e a janela de 24h é calculada igual a Meta calcula.
      ...(input.sentAt ? { createdAt: input.sentAt } : {}),
    },
  })
  // Cliente escreveu → reabre a conversa no Inbox (zera o "fechado pelo operador")
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now, resolvedAt: null } })
  await prisma.lead.update({ where: { id: lead.id }, data: { lastMessageAt: now } })
  // cliente respondeu → cancela checagens pendentes (sem-resposta, follow-up de orçamento
  // e a retomada das 9h — já que ele voltou a falar, não precisa do "bom dia, retomando").
  await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: { in: ['flow_noreply', 'budget_followup', 'chegada_followup', 'after_hours_resume', 'adiada_horario', 'consultor_20min'] }, done: false }, data: { done: true } })
  // 🎯 Cliente respondeu → contabiliza a resposta da variação de saudação (idempotente).
  if (!isSimulator) { const { registrarResposta } = await import('./greeting'); registrarResposta(lead.id).catch(() => {}) }

  // 🔔 Avisa o operador no celular (push) que chegou mensagem nova do cliente.
  if (!isSimulator) {
    const { enviarPush } = await import('./push')
    enviarPush({
      title: contact.name || contact.phone || 'Cliente',
      body: (input.displayText ?? text ?? '').slice(0, 120) || 'Nova mensagem',
      url: `/leads/${lead.id}`,
      tag: conversation.id,
    }).catch(() => {})
  }

  const base: IngestResult = {
    contactId: contact.id, conversationId: conversation.id, leadId: lead.id,
    reply: null, aiHandled: false, handoff: false,
    stage: pipeline.stages.find((s) => s.id === lead!.stageId)?.name ?? firstStage.name,
  }

  // 🔁 Cliente REENVIOU a mesma mensagem (clique duplo, anúncio reenviado) em até 10 min e nós já
  //    respondemos a primeira → não responde de novo (regra do dono: nunca repetir resposta).
  if (!isSimulator && text.trim().length >= 15 && !input.imageBase64 && !input.pdfBase64 && !input.pdfText) {
    const ultimas = await prisma.message.findMany({
      where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 6,
      select: { direction: true, content: true, createdAt: true },
    })
    // ultimas[0] = a mensagem que acabou de chegar; procura a inbound anterior a ela
    const idxAnt = ultimas.findIndex((m, i) => i > 0 && m.direction === 'inbound')
    if (idxAnt > 0) {
      const ant = ultimas[idxAnt]
      const respondemos = ultimas.slice(1, idxAnt).some((m) => m.direction === 'outbound')
      const { mesmoTexto } = await import('./repeticao')
      if (respondemos && mesmoTexto(ant.content ?? '', text) && Date.now() - ant.createdAt.getTime() < 10 * 60 * 1000) {
        console.log('[engine] cliente reenviou a mesma mensagem — não responde de novo')
        return { ...base, reply: null, aiHandled: true }
      }
    }
  }

  // ⏰ Mensagem ANTIGA (a Meta reentregou com atraso, >24h): a janela está fechada e texto livre
  //    seria recusado (131047). Em vez de rodar a IA, manda UMA vez o template aprovado de reabertura
  //    ("Recebemos o seu contato..."). Quando o cliente responder, a janela reabre e a IA segue normal.
  if (input.foraJanela && !isSimulator) {
    const jaEnviouHoje = await prisma.message.count({
      where: { conversationId: conversation.id, direction: 'outbound', createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    })
    const { dispatchOutbound, janelaAberta } = await import('./flow')
    // Se existe msg MAIS NOVA do cliente (janela aberta), ela já foi/será respondida normalmente:
    // a antiga só fica registrada no histórico, sem disparar nada.
    if (!jaEnviouHoje && !(await janelaAberta(conversation.id))) {
      await dispatchOutbound(conversation.id, '', undefined, 'system').catch((e) => console.error('[engine reabertura]', e))
    }
    return base
  }

  // Carrega config de IA do funil e da etapa atual
  const fullPipeline = await prisma.pipeline.findUnique({ where: { id: lead.pipelineId } })
  const currentStage = await prisma.stage.findUnique({ where: { id: lead.stageId } })

  // Bloqueio TOTAL: cliente recusou o bot (humanOnly) OU o operador DESLIGOU a IA deste lead
  // (aiEnabled=false) → NENHUMA automação/IA responde (só o humano atende). A mensagem do
  // cliente já foi salva acima — apenas não acionamos nada do bot.
  if (lead.humanOnly || !lead.aiEnabled) return base

  // 🚫 OPT-OUT IMEDIATO: cliente mandou PARAR / STOP / CANCELAR / SAIR / NÃO QUERO
  // Detectado via keyword ANTES da IA (resposta mais rápida, sem custo de LLM).
  // Cancela todas as automações, adiciona à blacklist e confirma ao cliente.
  const normText = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  // ⚠️ Só é opt-out quando a mensagem É o comando ("PARAR", "sair", "stop"…) ou um pedido INEQUÍVOCO.
  //    NUNCA por prefixo: "Para fazer no cartão…", "Não quero financiar…", "Cancela a entrada" são
  //    perguntas normais (já descadastrou cliente por engano). Casos ambíguos ficam com a IA.
  const tOpt = normText.replace(/[!.?,;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  const isOptOut = /^(parar|stop|sair|cancelar|descadastrar)( (por favor|pf|pfv|obrigad[oa]))?$/.test(tOpt)
    || /\b(para|pare|parem) de (me )?(mandar|enviar)( mensage(m|ns))?\b/.test(tOpt)
    || /\bnao (quero|desejo) (mais )?receber\b/.test(tOpt)
    || /\bnao (me )?(mand[ae]|envi[ae]) mais\b/.test(tOpt)
    || /\b(tir[ae]|remov[ae]|exclu[ai])( meu numero| me)? d[ao] (sua )?lista\b|\bsai(r)? da (sua |minha )?lista\b/.test(tOpt)
  if (isOptOut && !isSimulator) {
    const { dispatchOutbound } = await import('./flow')
    const { addNaLista } = await import('./lists')
    const msgConfirm = 'Tudo bem! 😊 Você foi removido da nossa lista e não receberá mais mensagens automáticas da KeroSolar. Se mudar de ideia, é só nos escrever novamente.'
    await dispatchOutbound(conversation.id, msgConfirm, undefined, 'ai')
    const numero = contact.phone || contact.whatsappId || conversation.externalId
    if (numero) await addNaLista(numero, 'no_send', 'Cliente pediu opt-out via palavra-chave PARAR.')
    await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, done: false }, data: { done: true } })
    await prisma.lead.update({ where: { id: lead.id }, data: { aiEnabled: false, humanOnly: true } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: '🚫 Opt-out via keyword — adicionado à blacklist e automações canceladas.' } })
    return { ...base, reply: null, aiHandled: true }
  }

  // 📢 SAUDAÇÃO DE ANÚNCIO META (WhatsApp Click-to-WhatsApp)
  // Quando alguém clica num anúncio Meta (Facebook / Instagram → WhatsApp), o WhatsApp
  // pré-preenche automaticamente a frase: "Oi! Como podemos ajudar?" / "Oi, como podemos
  // te ajudar?". Identificamos esse padrão e tratamos SEMPRE como ENTRADA — mesmo que o lead
  // já exista no funil (pode ter clicado o anúncio de novo = novo interesse). Isso garante:
  //   • Reset do estado de fora-de-horário (recebe prompt "agora ou depois?" se for noite)
  //   • Saudação de boas-vindas completa durante o horário comercial
  //   • Lead marcado como origem 'meta' para rastreamento de campanha
  // Frases pré-preenchidas dos anúncios da Meta (Click-to-WhatsApp / Insta / Face):
  //  • "Oi! Como podemos ajudar?" (saudação automática)
  //  • "Olá! Tenho interesse e queria mais informações, por favor." (texto do botão do anúncio)
  const isMetaAdEntry = /^(oi|ol[aá])[\s!,.]*como\s+podemos\s+(te\s+)?ajudar/i.test(text.trim())
    || /tenho\s+interesse\s+e\s+queria\s+mais\s+inform/i.test(text)
  if (isMetaAdEntry) {
    // Reset estado anterior de fora-de-horário para garantir o prompt correto
    if (lead.afterHoursAsked || lead.afterHoursProceed) {
      await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: false, afterHoursProceed: false } })
      lead = { ...lead, afterHoursAsked: false, afterHoursProceed: false }
    }
    // Para leads existentes: cria nota de retorno via anúncio (sem duplicar para novos)
    if (!isNewLead) {
      await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: '📢 Lead retornou via anúncio Meta (WhatsApp Click-to-WhatsApp).' } })
    }
  }

  // 🕑 Operador respondendo manualmente? A IA AGUARDA 30 min de inatividade dele antes de
  //    voltar a responder (cada mensagem do operador reinicia o tempo). Vale tanto p/ respostas
  //    pelo CRM quanto pelo app do WhatsApp (ambas ficam como outbound 'human'). A mensagem do
  //    cliente já foi salva acima — só não acionamos nenhuma resposta automática agora.
  {
    const MS_INATIVIDADE = 30 * 60 * 1000
    const ultimaHumana = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'outbound', senderType: 'human' },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    })
    if (ultimaHumana && Date.now() - new Date(ultimaHumana.createdAt).getTime() < MS_INATIVIDADE) {
      // EXCEÇÃO: se o cliente mandou o que GERA ORÇAMENTO (consumo em kWh, valor da conta, ou
      //   foto da conta), a IA libera o orçamento mesmo na pausa. Conversa comum continua aguardando.
      const { extrairConsumo } = await import('./solar-calc')
      const c = extrairConsumo(text)
      const gatilhoOrcamento = !!input.imageBase64 || !!input.pdfBase64 || !!input.pdfText || c.kwh != null || c.reais != null
      if (!gatilhoOrcamento) {
        console.log('[engine] operador ativo (<30min) → IA aguarda')
        return base
      }
      console.log('[engine] operador ativo (<30min), mas cliente informou consumo → libera o orçamento')
    }
  }

  // 4.1) Aviso de migração do sistema — enviado UMA vez por lead enquanto a config existir.
  //      Para desativar: apague a entrada 'migration_warning' em SystemConfig (Configurações).
  {
    const cfM = (lead.customFields as Record<string, unknown> | null) ?? {}
    if (!cfM.migrationWarningSent) {
      const migCfg = await prisma.systemConfig.findUnique({ where: { key: 'migration_warning' } })
      if (migCfg?.value) {
        const { dispatchOutbound } = await import('./flow')
        await dispatchOutbound(conversation.id, migCfg.value, undefined, 'system')
        await prisma.lead.update({
          where: { id: lead.id },
          data: { customFields: { ...cfM, migrationWarningSent: true } },
        })
        lead = { ...lead, customFields: { ...cfM, migrationWarningSent: true } } as typeof lead
      }
    }
  }

  // IA só responde se: lead ON + conversa ON + funil ON + etapa ON
  const aiOn = lead.aiEnabled && conversation.aiEnabled
    && (fullPipeline?.botEnabled ?? true)
    && (currentStage?.botEnabled ?? true)

  // A etapa tem alguma automação configurada? (chamada, palavra-chave ou inatividade)
  const stageAuto = stageHasAutomation(currentStage?.flow)

  // 4.3) Cliente recusa bot/IA/máquina → PARA TUDO e joga pro humano.
  //      Vale mesmo se só houver automação (sem IA conversacional).
  if (aiOn || stageAuto) {
    const { wantsHuman, performHandoff } = await import('./handoff')
    if (wantsHuman(text)) {
      const msg = await performHandoff(lead.id, conversation.id)
      return { ...base, reply: msg, aiHandled: true, handoff: true }
    }
  }

  // 4.37) Cliente pede para reiniciar o atendimento → volta pra Chegada do zero
  if (aiOn || stageAuto) {
    const txtR = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const wantsRestart = /\b(reinici|recomeç|come(c|ç)ar? (de novo|do zero|tudo de novo)|volta(r|r ao inicio|r ao começo)|do zero|do inicio|do começo|reset|zerar o atendimento)\b/.test(txtR)
    if (wantsRestart && !lead.humanOnly) {
      // cancela todos os agendamentos pendentes
      await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, done: false }, data: { done: true } })
      // limpa o flowState da conversa
      await prisma.conversation.update({ where: { id: conversation.id }, data: { flowState: Prisma.DbNull } })
      // volta para a primeira etapa (Chegada)
      const firstStage = pipeline.stages[0]
      await prisma.lead.update({ where: { id: lead.id }, data: { stageId: firstStage.id, status: 'open', closedAt: null, afterHoursAsked: false, afterHoursProceed: false } })
      await prisma.note.create({ data: { leadId: lead.id, type: 'stage_change', content: 'Cliente pediu para reiniciar o atendimento — voltou para Chegada.' } })
      const { enterStage, dispatchOutbound } = await import('./flow')
      const msg = 'Claro! Vamos começar de novo 😊'
      await simularDigitacao(msg)
      await dispatchOutbound(conversation.id, msg, undefined, 'ai')
      await enterStage(lead.id, firstStage.id).catch(() => {})
      // dispatchOutbound já enviou pelo WhatsApp — reply: null evita duplo envio via sendText
      return { ...base, reply: null, aiHandled: true, stage: firstStage.name }
    }
  }

  // 4.38) Fluxo de blocos esperando resposta? → salva a resposta e continua o fluxo
  if (aiOn || stageAuto) {
    const { resumeOnReply } = await import('./flow-blocks')
    if (await resumeOnReply(conversation.id, lead.id, text)) {
      return { ...base, aiHandled: true }
    }
  }

  // 4.39) Lead NOVO numa etapa com automação → dispara o fluxo da etapa (ex: Chegada)
  if (isNewLead && stageAuto) {
    const { enterStage } = await import('./flow')
    await enterStage(lead.id, lead.stageId).catch((e) => console.error('[enterStage novo]', e))
    return { ...base, aiHandled: true }
  }

  // 4.32) Recepção fora do horário (20h–8h, regra do dono 2026-11-09): 1º contato recebe a saudação de
  //       recepção; se o cliente interagir, pergunta se continua agora ou retornamos no próximo dia útil.
  if (aiOn || stageAuto) {
    const spHour = horaBrasilia()
    // Fora do horário (regra do dono, 2026-11-09): a partir das 20h até as 8h.
    const isAfterHours = spHour >= 20 || spHour < 8
    const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const { dispatchOutbound } = await import('./flow')

    // 📅 Retomada = PRÓXIMO DIA ÚTIL em horário comercial (janela do funil, ex.: 9h seg–sex).
    const { nextAllowedSlot, respeitaHorarioGlobal, janelaDoFunil } = await import('./schedule-window')
    const pipeJ = await prisma.pipeline.findUnique({ where: { id: lead.pipelineId }, select: { sendStartHour: true, sendEndHour: true } })
    const janelaJ = janelaDoFunil(pipeJ?.sendStartHour, pipeJ?.sendEndHour)
    const retomadaEm = nextAllowedSlot(respeitaHorarioGlobal(new Date()), janelaJ)
    const diaSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
    const difDias = Math.round((Date.parse(diaSP(retomadaEm)) - Date.parse(diaSP(new Date()))) / 86400000)
    const diaRetomada = difDias <= 0 ? 'hoje' : difDias === 1 ? 'amanhã'
      : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(retomadaEm)
    const horaRetomada = `${horaBrasilia(retomadaEm)}h`

    // 🌅 Arma a RETOMADA no próximo dia útil: quem recebe o "agora ou depois?" (ou pede pra deixar
    //    registrado) e fica sem responder será retomado pela IA no horário comercial.
    //    (Tipo 'after_hours_resume' em flow.ts; cancelado automaticamente se o cliente responder.)
    const armarRetomada9h = async () => {
      try {
        await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: 'after_hours_resume', done: false }, data: { done: true } })
        await prisma.scheduledAction.create({ data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'after_hours_resume', payload: {} as object, runAt: retomadaEm } })
      } catch (e) { console.error('[engine] armarRetomada9h', e) }
    }

    if (!isAfterHours && (lead.afterHoursAsked || lead.afterHoursProceed)) {
      // voltou a ser horário comercial → reseta o estado
      await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: false, afterHoursProceed: false } })
      lead.afterHoursAsked = false; lead.afterHoursProceed = false
    }

    if (isAfterHours && !lead.afterHoursProceed) {
      const querDepois = /(so |apenas )?(registr|deixa registr|deixar registr|pode deixar|depois|amanha|horario comercial|outro dia|mais tarde)/.test(norm)
      const querAgora = /(prossegu|continu|agora|atende|atender|quero sim|pode seguir|vamos|sim quero|seguir)/.test(norm)
      // Lead que JÁ conversou NÃO é novo → não recebe a pergunta de fora do horário.
      // Usa lastMessageAt (carregado do banco antes de qualquer update desta chamada) —
      // mais confiável que contar mensagens na DB (que pode estar vazia para clientes
      // migrados, leads criados manualmente ou reconexões do Baileys).
      // Exceção: saudação de anúncio Meta → sempre tratada como novo contato (isMetaAdEntry).
      const jaConversou = !isNewLead && !!lead.lastMessageAt && !isMetaAdEntry
      const saud = saudacaoAgora()

      // Estado da recepção fora do horário: 1º contato recebe a SAUDAÇÃO de recepção; quando o cliente
      // interage, aí sim perguntamos "continuar agora ou retornamos no próximo dia útil?".
      const cfFH = (lead.customFields as Record<string, unknown> | null) ?? {}
      const recebeuRecepcao = typeof cfFH.recepcaoForaHorario === 'string'
        && Date.now() - Date.parse(cfFH.recepcaoForaHorario as string) < 16 * 3600 * 1000   // vale para esta noite
      // Mandou a conta / consumo → quer continuar, não precisa perguntar
      const mandouConta = !!(input.imageBase64 || input.pdfBase64 || input.pdfText)
        || (/\d/.test(norm) && /(kwh|kw\/h|quilowatt|r\$|reais|conta|pain|placa)/.test(norm))

      if (!jaConversou && !lead.afterHoursAsked && !recebeuRecepcao && !querDepois) {
        // 1) PRIMEIRO contato fora do horário → saudação de recepção (a mesma do horário comercial)
        if (!mandouConta) {
          await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfFH, recepcaoForaHorario: new Date().toISOString() } as object } })
          const cfgW = await prisma.systemConfig.findUnique({ where: { key: 'welcome_message' } })
          const msgW = (cfgW?.value || `${saud}! Obrigada pelo contato com a KeroSolar 😊 Para eu já preparar seu orçamento de energia solar, me envia a *foto da sua conta de luz* — ou, se preferir, me diz seu *consumo médio em kWh* ou o *valor médio da conta em reais*. Qualquer uma das opções já serve!`).replace(/\{SAUDACAO\}/g, saud)
          await simularDigitacao(msgW)
          await dispatchOutbound(conversation.id, msgW, undefined, 'ai')
          // sem resposta → cobrança normal da etapa (o agendador só envia em horário permitido)
          const nrW = (currentStage?.flow as { noReply?: { minutes?: number } } | null)?.noReply
          if (nrW?.minutes && nrW.minutes > 0 && !isSimulator) {
            const { scheduleNoReply } = await import('./flow-blocks')
            await scheduleNoReply(lead.id, conversation.id, lead.stageId).catch(() => {})
          }
          return { ...base, reply: null, aiHandled: true }
        }
        // já chegou com a conta/consumo → segue direto para o orçamento
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursProceed: true } })
        lead.afterHoursProceed = true
      } else if (recebeuRecepcao && !lead.afterHoursAsked && !querAgora && !querDepois) {
        // 2) Cliente INTERAGIU com a recepção → pergunta se continua agora ou no próximo dia útil
        if (mandouConta) {
          await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursProceed: true } })
          lead.afterHoursProceed = true
        } else {
          await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: true } })
          await armarRetomada9h()   // se ficar sem responder, a IA retoma no próximo dia útil
          // Regra do dono (2026-11-11): se o cliente fez uma PERGUNTA, primeiro RESPONDE a pergunta
          // (fluxo normal abaixo) e DEPOIS pergunta se quer continuar — a pergunta vai como 2ª mensagem.
          const ehPergunta = /\?/.test(text) || /^\s*(como|qual|quais|quanto|quantos|quantas|quando|onde|por ?que|voces|vcs|voce|vc|tem|teria|faz|fazem|aceita|aceitam|parcela|parcelam|pode|posso|da pra|e possivel|existe|trabalham|atendem|instalam)\b/.test(norm)
          const perguntaContinuar = `Já estamos fora do horário comercial 🌙 Você quer *continuar agora* comigo, ou prefere que a gente *retorne ${diaRetomada}*, no horário comercial (a partir das ${horaRetomada})?`
          if (ehPergunta) {
            base.followUp = perguntaContinuar
            lead.afterHoursProceed = true   // só nesta mensagem (no banco continua "perguntado") → responde agora
          } else {
            await simularDigitacao(perguntaContinuar)
            await dispatchOutbound(conversation.id, perguntaContinuar, undefined, 'ai')
            return { ...base, reply: null, aiHandled: true }
          }
        }
      }

      if (lead.afterHoursProceed) {
        // decidiu continuar (ou mandou a conta) → segue o fluxo normal abaixo
      } else if (querDepois) {
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: true } })
        const msg = `Perfeito! Deixei seu contato registrado e a gente retorna ${diaRetomada}, no horário comercial (a partir das ${horaRetomada}). ${saud === 'Boa noite' ? 'Tenha uma ótima noite' : 'Até logo'}! 😊`
        await simularDigitacao(msg)
        await dispatchOutbound(conversation.id, msg, undefined, 'ai')
        await armarRetomada9h()   // cliente pediu pra deixar registrado → retomamos às 9h
        // dispatchOutbound já enviou pelo WhatsApp — reply: null evita duplo envio via sendText
        return { ...base, reply: null, aiHandled: true }
      }
      if (querAgora || lead.afterHoursAsked) {
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursProceed: true } })
        lead.afterHoursProceed = true
        // segue o fluxo normal abaixo
      } else if (jaConversou) {
        // Lead já estava EM CONVERSA (não é novo) → NÃO faz a pergunta de "agora ou depois";
        // segue o atendimento normal (o operador/IA continua de onde parou).
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursProceed: true } })
        lead.afterHoursProceed = true
      } else {
        // (a recepção e a pergunta já foram tratadas acima) → segue o atendimento normal
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursProceed: true } })
        lead.afterHoursProceed = true
      }
    }
  }

  // 4.33) Cliente INICIAL em HORÁRIO COMERCIAL → manda a saudação COMPLETA, já pedindo a
  //       conta / consumo (kWh ou R$). Fora do horário (21h–06h) o bloco acima já tratou
  //       com a opção "agora ou depois". Só dispara no PRIMEIRO contato (ainda não respondemos)
  //       e quando o cliente AINDA não informou consumo na mensagem.
  if (aiOn || stageAuto) {
    const spHourC = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
    const horarioComercial = spHourC >= 8 && spHourC < 20   // fora disso (20h–8h) o bloco 4.32 já tratou
    const jaRespondemos = await prisma.message.count({ where: { conversationId: conversation.id, direction: 'outbound' } })
    const txtC = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const jaTemConsumo = /\d/.test(txtC) && /(kwh|kw\/h|quilowatt|r\$|reais|pain|placa|m[oó]dulo)/.test(txtC)
    // isMetaAdEntry: anúncio Meta sempre dispara a saudação mesmo que jaRespondemos > 0
    // (lead pode ter clicado o anúncio de novo depois de uma conversa anterior).
    // 🖼️ Se o cliente JÁ mandou uma imagem (foto da conta), NÃO dispara a saudação pedindo a conta
    //    de novo — deixa a mensagem seguir para a leitura por visão (extractBillFromImage) logo abaixo.
    if (horarioComercial && (jaRespondemos === 0 || isMetaAdEntry) && !jaTemConsumo && !input.imageBase64 && !input.pdfBase64 && !input.pdfText && !lead.humanOnly) {
      const saud = saudacaoAgora()
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'welcome_message' } })
      const msg = (cfg?.value || `${saud}! Obrigada pelo contato com a KeroSolar 😊 Para eu já preparar seu orçamento de energia solar, me envia a *foto da sua conta de luz* — ou, se preferir, me diz seu *consumo médio em kWh* ou o *valor médio da conta em reais*. Qualquer uma das opções já serve!`).replace(/\{SAUDACAO\}/g, saud)
      const { dispatchOutbound } = await import('./flow')
      await simularDigitacao(msg)
      await dispatchOutbound(conversation.id, msg, undefined, 'ai')
      const nrC = (currentStage?.flow as { noReply?: { minutes?: number } } | null)?.noReply
      if (nrC?.minutes && nrC.minutes > 0 && !isSimulator) {
        const { scheduleNoReply } = await import('./flow-blocks')
        await scheduleNoReply(lead.id, conversation.id, lead.stageId).catch(() => {})
      }
      // 👤 Regra do dono (2026-11-10): 20 min sem resposta à recepção, DENTRO do horário de
      //    atendimento (janela do funil, dias úteis) → o Henrique se apresenta como consultor técnico.
      //    Fora do horário / fim de semana: nada muda (fluxo de fora do horário).
      if (!isSimulator) {
        try {
          const { nextAllowedSlot, janelaDoFunil } = await import('./schedule-window')
          const pipeC = await prisma.pipeline.findUnique({ where: { id: lead.pipelineId }, select: { sendStartHour: true, sendEndHour: true } })
          const janC = janelaDoFunil(pipeC?.sendStartHour, pipeC?.sendEndHour)
          const em20 = new Date(Date.now() + 20 * 60 * 1000)
          const dentro = (t: Date) => nextAllowedSlot(t, janC).getTime() <= t.getTime() + 1000
          if (dentro(new Date()) && dentro(em20)) {
            await prisma.scheduledAction.create({ data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'consultor_20min', payload: {} as object, runAt: em20 } })
          }
        } catch (e) { console.error('[engine] consultor_20min', e) }
      }
      // dispatchOutbound já enviou pelo WhatsApp — reply: null evita duplo envio via sendText
      return { ...base, reply: null, aiHandled: true }
    }
  }

  // 4.35) Reengajamento: cliente sumiu 10+ dias e voltou (e NÃO é humanOnly).
  //       Envia a mensagem de retorno E SEGUE o fluxo normal (a IA também responde).
  const prevLast = lead.lastMessageAt ? new Date(lead.lastMessageAt).getTime() : null
  if ((aiOn || stageAuto) && prevLast && Date.now() - prevLast > 10 * 24 * 60 * 60 * 1000) {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'return_message' } })
    const msg = cfg?.value || DEFAULT_RETURN_MESSAGE
    const { dispatchOutbound } = await import('./flow')
    await simularDigitacao(msg)
    await dispatchOutbound(conversation.id, msg, undefined, 'ai')  // envia já no canal + grava
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'Cliente retornou após 10+ dias — mensagem de reengajamento enviada.' } })
    // NÃO retorna: continua para FAQ / palavra-chave / IA responder a mensagem do cliente
  }

  // 4.4) FAQ GLOBAL — respostas-padrão valem mesmo com a IA da etapa desligada,
  //      desde que a etapa tenha automação. Não aciona a IA conversacional.
  if (aiOn || stageAuto) {
    const { matchGlobalFaq } = await import('./faq')
    const faq = matchGlobalFaq(text)
    if (faq) {
      await simularDigitacao(faq)
      await prisma.message.create({
        data: { conversationId: conversation.id, direction: 'outbound', senderType: 'ai', content: faq },
      })
      await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })
      return { ...base, reply: faq, aiHandled: true }
    }
  }

  if (!aiOn) return base

  // 4.6) Palavra-chave configurada na etapa → muda de etapa (dispara chamada da nova)
  const { keywordTargetFor, moveLeadToStage } = await import('./flow')
  const kwTarget = await keywordTargetFor(lead.stageId, text)
  if (kwTarget && kwTarget !== lead.stageId) {
    await moveLeadToStage(lead.id, kwTarget, 'Movido por palavra-chave do cliente.')
    const tgt = pipeline.stages.find((s) => s.id === kwTarget)
    return { ...base, aiHandled: true, stage: tgt?.name ?? base.stage }
  }

  // 💳💰 SIMULAÇÃO DE PAGAMENTO (cartão / financiamento / entrada) — unificado, com MEMÓRIA de
  //    contexto (cf.simMode, cf.cartaoParcelas, cf.entrada). Intercepta só pedidos CLAROS de cartão
  //    ou de entrada/sinal; perguntas genéricas de prazo do financiamento ("em 24x") ficam com a IA
  //    (que tem a tabela). Garante: cartão usa a tabela do cartão (não a do financiamento), a entrada
  //    vale no contexto certo (cartão OU financiamento), e nunca trava por mensagem repetida.
  {
    const cfNow = (lead.customFields as Record<string, unknown> | null) ?? {}
    const { extrairEntrada, financiamentoEntradaTexto, entradaCompletaTexto, orcamentoTexto, carregarTabelaFinanciamento } = await import('./solar-calc')
    const { extrairCartao, simularCartao, formatarCartao, formatarCartaoMulti } = await import('./card-calc')

    const ent = extrairEntrada(text)
    const cartao = extrairCartao(text)
    const cartaoAsked = !!cfNow.cartaoAsked
    const entradaAsked = !!cfNow.entradaAsked
    const ehConsumo = /kwh|kw\b|\bk\b|placa|painel|conta|fatura/i.test(text)
    const semJuros = /sem juros?|sem jur/i.test(text)   // "tem cartão sem juros?"

    // nº de parcelas do cartão: da mensagem, ou número solto quando estávamos esperando ("24")
    let parcelas = cartao.parcelas
    if (parcelas == null && cartaoAsked) { const mN = text.match(/\b(\d{1,2})\b/); if (mN) parcelas = parseInt(mN[1], 10) }

    // ❓ Pergunta sobre o PROCESSO ("como é feito?", "vem aqui passar o cartão?", "maquininha?", "link?")
    //    NÃO é pedido de simulação → quem responde é a IA. Só simula se tiver número/prazo/valor.
    const temNumeroSim = cartao.parcelas != null || cartao.lista.length > 0 || ent.valor != null || ent.remover
    const perguntaProcesso = !temNumeroSim && (
      /\bcomo (e|é|eh|seria|funciona|faz|fa[cç]o|pago|que|vai ser|vou)(?![a-zà-ú])/i.test(text)
      || /\b(vem|vir|vai vir|venha)\b.*\b(aqui|passar|cobrar)\b|\bpassa(r)? o cart[aã]o|\bmaquininha|\blink\b|\bpresencial|\bonde\b|\bquando\b/i.test(text))

    const pedeCartao = !perguntaProcesso && (cartao.intent || semJuros || (cartaoAsked && parcelas != null))
    const pedeEntrada = !perguntaProcesso && (ent.intent || ent.remover || (entradaAsked && ent.valor != null && !ehConsumo))

    // 🔁 NUNCA REPETIR: se a simulação gerada for idêntica a uma das últimas mensagens enviadas,
    //    não reenvia — a mensagem segue para a IA, que responde a pergunta de fato (ou pede pra refazer).
    const REPETIDA = Symbol('repetida')
    const recentesOut = (pedeCartao || pedeEntrada)
      ? (await prisma.message.findMany({ where: { conversationId: conversation.id, direction: 'outbound' }, orderBy: { createdAt: 'desc' }, take: 4, select: { content: true } })).map((m) => m.content.trim())
      : []

    if (pedeCartao || pedeEntrada) try {
      const cfSolar = cfNow.solar as { valorSistema?: number } | undefined
      // 🔢 VALOR DO SISTEMA = sempre o do ÚLTIMO orçamento ENVIADO nesta conversa. Vale mesmo quando
      //    o orçamento mais recente foi mandado MANUALMENTE pelo operador (fora do fluxo automático,
      //    que não atualiza o cf.solar). Fallback: o valor guardado no lead (cf.solar).
      let valorSist: number | null = typeof cfSolar?.valorSistema === 'number' ? cfSolar.valorSistema : null
      {
        const ultimoOrc = await prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: 'outbound', content: { contains: 'Sistema completo' } },
          orderBy: { createdAt: 'desc' }, select: { content: true },
        })
        const m = ultimoOrc?.content.match(/sistema completo[:\s]*r\$\s*([\d.,]+)/i)
        if (m) {
          const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
          if (isFinite(v) && v > 0) valorSist = v
        }
      }
      const { dispatchOutbound } = await import('./flow')
      const responder = async (msg: string) => {
        if (recentesOut.includes(msg.trim())) { console.log('[engine] simulação repetida bloqueada — segue para a IA'); throw REPETIDA }
        await simularDigitacao(msg); await dispatchOutbound(conversation.id, msg, undefined, 'ai', undefined, true)
      }

      if (!valorSist) {
        // Regra do dono (2026-11-10): RESPONDE a pergunta primeiro ("parcelam no cartão?" → "Sim!"),
        // depois puxa os dados para o orçamento.
        const resposta = pedeCartao
          ? 'Sim! 😊 Parcelamos no cartão de crédito em até *24x*, sendo até *3x sem juros*.'
          : 'Sim, dá pra dar uma *entrada* e parcelar o restante 😊'
        await responder(`${resposta} Pra eu já te mostrar as parcelas certinhas, me envia a *foto da sua conta de luz* — ou me diz seu *consumo médio em kWh* ou o *valor médio da conta*.`)
        return { ...base, reply: null, aiHandled: true }
      }

      // ENTRADA: remover, definir nesta mensagem, ou herdar a guardada
      let entrada = typeof cfNow.entrada === 'number' ? (cfNow.entrada as number) : 0
      if (ent.remover) entrada = 0
      else if (ent.valor != null && (ent.intent || cartaoAsked || cartao.intent || entradaAsked)) entrada = ent.valor
      entrada = Math.max(0, Math.min(entrada, valorSist))

      // Pediu entrada SEM valor e SEM contexto de cartão → pergunta o valor (passo 1)
      if (pedeEntrada && !ent.remover && ent.valor == null && !pedeCartao) {
        await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, entradaAsked: true } as object } })
        await responder('Que ótimo! 😊 De quanto seria a *entrada*? (em reais)')
        return { ...base, reply: null, aiHandled: true }
      }

      // MODO: cartão se pediu cartão / estava esperando parcelas; senão, se o último contexto era
      // cartão e há parcelas (atuais ou guardadas), mantém cartão; caso contrário, financiamento.
      const modo: 'cartao' | 'financiamento' =
        pedeCartao ? 'cartao'
        : (cfNow.simMode === 'cartao' && (parcelas != null || typeof cfNow.cartaoParcelas === 'number')) ? 'cartao'
        : 'financiamento'

      // 💵 ENTRADA informada → FINANCIAMENTO + CARTÃO, ambos sobre o SALDO, numa mensagem só
      //    (decisão do dono). Prazos do cartão: os que o cliente pediu, senão 3x/12x/24x.
      if (entrada > 0) {
        await carregarTabelaFinanciamento()
        const padrao = [3, 12, 24]
        const prazosCartao = cartao.lista.length >= 2 ? cartao.lista
          : (parcelas != null && parcelas >= 1 && parcelas <= 24) ? [...new Set([...padrao, parcelas])]
          : padrao
        await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: modo, cartaoAsked: false, entradaAsked: false, entrada } as object } })
        await responder(entradaCompletaTexto(valorSist, entrada, prazosCartao))
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Simulação com entrada de R$ ${entrada.toLocaleString('pt-BR')} (financiamento + cartão do saldo).` } }).catch(() => {})
        return { ...base, reply: null, aiHandled: true }
      }

      if (modo === 'cartao') {
        // Vários prazos pedidos de uma vez ("6x, 12x e 24x") → simula TODOS numa mensagem só.
        if (cartao.lista.length >= 2) {
          const sims = cartao.lista.map((n) => simularCartao(valorSist - entrada, n)).filter((s): s is NonNullable<typeof s> => !!s)
          if (sims.length >= 2) {
            await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: 'cartao', cartaoAsked: false, entradaAsked: false, cartaoParcelas: sims[sims.length - 1].parcelas, entrada: entrada || null } as object } })
            await responder(formatarCartaoMulti(sims, valorSist, entrada))
            await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Simulação no cartão ${sims.map((s) => s.parcelas + 'x').join(', ')}.` } }).catch(() => {})
            return { ...base, reply: null, aiHandled: true }
          }
        }
        const nParc = parcelas ?? (typeof cfNow.cartaoParcelas === 'number' ? (cfNow.cartaoParcelas as number) : null)
        if (!nParc) {
          await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: 'cartao', cartaoAsked: true, entradaAsked: false, entrada: entrada || null } as object } })
          const msg = semJuros
            ? 'Sim! No cartão de crédito dá pra fazer em até *3x sem juros* 😊 (acima de 3x entram as taxas). Em quantas vezes você quer que eu simule? (de 1 a 24)'
            : 'No cartão de crédito dá pra parcelar em até *24x* (sendo até *3x sem juros*)! Em quantas vezes você quer que eu simule? (de 1 a 24) 😊'
          await responder(msg)
          return { ...base, reply: null, aiHandled: true }
        }
        if (nParc > 24) {
          await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: 'cartao', cartaoAsked: true } as object } })
          await responder('No cartão a gente parcela em até *24x* 😊 Em quantas vezes (de 1 a 24) você quer simular?')
          return { ...base, reply: null, aiHandled: true }
        }
        const sim = simularCartao(valorSist - entrada, nParc)
        await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: 'cartao', cartaoAsked: false, entradaAsked: false, cartaoParcelas: nParc, entrada: entrada || null } as object } })
        if (sim) await responder(formatarCartao(sim, valorSist, entrada))
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Simulação no cartão ${nParc}x${entrada ? ` com entrada de R$ ${entrada.toLocaleString('pt-BR')}` : ''}.` } }).catch(() => {})
        return { ...base, reply: null, aiHandled: true }
      }

      // FINANCIAMENTO (com ou sem entrada)
      await carregarTabelaFinanciamento()
      await prisma.lead.update({ where: { id: lead.id }, data: { customFields: { ...cfNow, simMode: 'financiamento', cartaoAsked: false, entradaAsked: false, entrada: entrada || null } as object } })
      if (entrada > 0) {
        await responder(financiamentoEntradaTexto(valorSist, entrada))
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Financiamento com entrada de R$ ${entrada.toLocaleString('pt-BR')}.` } }).catch(() => {})
      } else {
        const cfSolarFull = cfNow.solar as Parameters<typeof orcamentoTexto>[0] | undefined
        await responder(`${ent.remover ? 'Sem problema, removi a entrada! 😊 ' : ''}${cfSolarFull ? orcamentoTexto(cfSolarFull) : 'Segue o financiamento pelo valor do sistema.'}`)
      }
      return { ...base, reply: null, aiHandled: true }
    } catch (e) { if (e !== REPETIDA) throw e }
  }

  // 5) Agente IA
  // Busca as ÚLTIMAS 40 mensagens (mais recentes) em ordem decrescente e depois
  // inverte → conversa em ordem cronológica. Assim a IA SEMPRE vê o contexto atual,
  // mesmo em conversas longas (>40 msgs) — antes pegava as 40 mais antigas e
  // perdia as mensagens recentes, deixando a IA sem ver a pergunta do cliente.
  const msgsRaw = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' }, take: 40,
  })
  const msgs = msgsRaw.reverse()
  const history: ChatMessage[] = msgs.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }))
  // Se o cliente enviou uma imagem OU um PDF nesta mensagem, injeta no último item do histórico
  // para a IA ENXERGAR o conteúdo (e não "chutar" que precisa de senha de acesso, etc.).
  if ((input.imageBase64 || input.pdfBase64 || input.pdfText) && history.length > 0) {
    const last = history[history.length - 1]
    if (last.role === 'user') {
      if (input.imageBase64) {
        last.imageBase64    = input.imageBase64
        last.imageMediaType = input.imageMediaType ?? 'image/jpeg'
      }
      if (input.pdfText) last.content = `${last.content}\n\n[Conteúdo da conta de luz (PDF):\n${input.pdfText.slice(0, 6000)}\n]`
      else if (input.pdfBase64) last.pdfBase64 = input.pdfBase64
    }
  }

  // 4.7) Cálculo solar — extrai dados da mensagem ou da imagem (conta de luz)
  const { extrairConsumo, calcularSolar, calcularSolarPorKwh, resumoParaIA, orcamentoTexto, MINIMO_KIT_KWH, MINIMO_KIT_PRECO, consumoKwhValido, contaReaisValida, carregarTabelaFinanciamento, aplicarHibrido } = await import('./solar-calc')
  // Clientes pós-venda ("Já é cliente") não recebem cálculo solar — evita orçamentos indevidos
  const isPosSaleStage = /j[aá]\s*[eé]\s*cliente|p[oó]s.?venda/i.test(currentStage?.name ?? '')
  // Carrega a tabela de financiamento das Configurações (ou usa a padrão) ANTES dos cálculos.
  await carregarTabelaFinanciamento()
  let consumo = isPosSaleStage ? {} : extrairConsumo(text)

  // Se veio imagem → extrai via visão da IA (conta de luz OU detecta documento de identidade)
  let billData: Awaited<ReturnType<typeof extractBillFromImage>> | null = null
  const cfImg = (lead.customFields as Record<string, unknown> | null) ?? {}
  const jaTemOrcamento = !!(cfImg.solar || cfImg.consumoKwh || cfImg.billValue)
  // Conta nova (foto ou PDF) é SEMPRE lida, mesmo se o lead já tem orçamento: o cliente pode ter
  // MAIS DE UMA CONTA (outro imóvel/comércio) e cada uma merece o seu orçamento.
  const ehPdf = !!(input.pdfText || input.pdfBase64)
  let contaNovaLida = false
  if ((input.imageBase64 || ehPdf) && !consumo.kwh && !consumo.reais) {
    const aiCfg = await loadAiConfig()
    billData = input.pdfText
      ? await extractBillFromImage(aiCfg, '', 'text/plain', input.pdfText)
      : input.pdfBase64
      ? await extractBillFromImage(aiCfg, input.pdfBase64, 'application/pdf')
      : await extractBillFromImage(aiCfg, input.imageBase64!, input.imageMediaType ?? 'image/jpeg')
    // 🚫 SÓ gera orçamento de CONTA DE LUZ real (docType 'bill') ou de ANÚNCIO/KIT solar (tem painéis).
    //    IPTU, conta de água, boleto, RG, foto aleatória (docType 'other'/'identity' sem painéis) → NÃO
    //    usar nenhum número lido — assim a IA não "inventa" consumo e pede a conta de luz certa.
    // Média do histórico calculada pelo CÓDIGO (regra: média de todos os meses da conta, não só o atual).
    const mediaHist = input.pdfText ? mediaHistoricoConsumo(input.pdfText) : null
    if (mediaHist) console.log('[engine] média do histórico do PDF: %d kWh (%d meses)', mediaHist.media, mediaHist.meses)
    const ehContaOuKit = billData.docType === 'bill' || billData.paineis != null || mediaHist != null
    if (ehContaOuKit) {
      if (mediaHist)                consumo = { kwh: mediaHist.media }
      else if (billData.kwh)        consumo = { kwh: billData.kwh }
      else if (billData.paineis)    consumo = { kwh: billData.paineis * 60 }  // 1 painel = 60 kWh
      else if (billData.valor)      consumo = { reais: billData.valor }
      contaNovaLida = !!(consumo.kwh || consumo.reais)
      if (billData.medidor || billData.distribuidora) {
        const billInfo = [billData.medidor, billData.distribuidora].filter(Boolean).join(' | ')
        text = `${text}\n[Dados lidos da foto: ${billInfo}]`.trim()
      }
    } else if (!jaTemOrcamento) {
      // Documento que NÃO é conta de luz → avisa a IA pra pedir a conta certa, sem calcular nada.
      // (Se já tem orçamento, pode ser foto do telhado/medidor etc. — não fica pedindo conta à toa.)
      const oQ = billData.isIdentityDoc ? 'um documento de identidade' : 'um documento que não é conta de luz (ex.: IPTU, água, boleto)'
      text = `${text}\n[A imagem enviada é ${oQ} — NÃO gere orçamento; peça gentilmente a CONTA DE LUZ/ENERGIA (ou o consumo em kWh).]`.trim()
    }
  }

  // ── Financiamento: a COLETA dos dados (nome, CPF, nascimento, CEP, e-mail) é guiada
  //    pela IA (ver seção "FINANCIAMENTO — COLETA DE DADOS" no prompt). A IA move pra etapa
  //    "Financiamento pedido de documentos" (routeToStage), confere os dados (texto ou
  //    documento) e só faz handoff pro consultor quando os 5 dados estão completos.
  //    Por isso NÃO pausamos a IA automaticamente ao detectar um CPF aqui.

  // ── Aceitação de orçamento: cliente confirma que quer prosseguir ─────────────
  // Dispara quando o lead já tem orçamento calculado E a mensagem indica aceitação.
  // → Confirma, agradece, move para "Financiamento - Pedido de Documentos" e avisa humano.
  const cfEarly = (lead.customFields as Record<string, unknown> | null) ?? {}
  const temOrcamento = !!(cfEarly.solar || cfEarly.consumoKwh || cfEarly.billValue)
  const txtNormAceit = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  // ATENÇÃO: NÃO incluir "quero financiar"/"quero parcelar"/"quero o financiamento" aqui —
  // são AMBÍGUOS (cliente quer VER/entender as opções, não fechar). Aceitação só explícita.
  const aceitouOrcamento = temOrcamento && /\b(aceito|aceitar|fechei|vou fechar|quero fechar|topei|vamos fechar|bora fechar|fechado|quero o sistema|quero instalar|quero contratar|quero assinar|me manda o contrato|quero o contrato|pode fechar|pode comecar|quero prosseguir)\b/.test(txtNormAceit)

  if (aceitouOrcamento && !lead.humanOnly) {
    const FINANCING_STAGE = 'Financiamento pedido de documentos'
    // Casamento ROBUSTO: etapa de "financiamento" + "pedido/documento" (não depende de traço/maiúscula)
    const targetStage = pipeline.stages.find((s) => {
      const n = norm(s.name)
      return n.includes('financiamento') && (n.includes('pedido') || n.includes('documento'))
    })

    const reply = 'Ótimo! 🎉 Que boa notícia! Confirmei aqui que está tudo certo com o orçamento — obrigado pela confiança! Vou encaminhar agora para nosso consultor dar início ao processo. Em breve ele entrará em contato com você para os próximos passos 😊'

    const leadUpd: Prisma.LeadUncheckedUpdateInput = { highPriority: true, aiEnabled: false }
    if (targetStage && targetStage.id !== lead.stageId) {
      leadUpd.stageId = targetStage.id
      await prisma.note.create({ data: { leadId: lead.id, type: 'stage_change', content: `IA moveu para "${FINANCING_STAGE}" — cliente aceitou o orçamento.` } })
    }
    await prisma.lead.update({ where: { id: lead.id }, data: leadUpd })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    await prisma.task.create({ data: { leadId: lead.id, title: '🎉 ORÇAMENTO ACEITO — iniciar processo de financiamento', type: 'call', dueAt: now } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'Cliente aceitou o orçamento — encaminhado para financiamento e IA desativada.' } })
    const { notificarDono } = await import('./flow')
    const nomeAlerta = contact.name || contact.phone || conversation.externalId || 'cliente'
    await notificarDono(`🔥 *FECHAMENTO — PRIORIDADE MÁXIMA*\n\nO cliente *${nomeAlerta}* aceitou o orçamento e quer prosseguir!\n\n➡️ Acesse o CRM agora para dar continuidade.`).catch(() => {})

    await simularDigitacao(reply)
    await prisma.message.create({ data: { conversationId: conversation.id, direction: 'outbound', senderType: 'ai', content: reply } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })

    if (targetStage) {
      const { enterStage } = await import('./flow')
      await enterStage(lead.id, targetStage.id).catch(() => {})
    }

    return { ...base, reply, aiHandled: true, handoff: true, stage: targetStage?.name ?? base.stage }
  }

  // 🔒 TRAVA DE SEGURANÇA (regra universal: nunca chutar valor). Descarta consumo/valor
  // fora da faixa realista — evita orçamento absurdo quando o número lido é código de
  // barras / nº de instalação do PDF ou erro de OCR. Sem número confiável → não calcula nada
  // e a IA segue pedindo o consumo (ou passa pro humano), em vez de mandar valor louco.
  if (consumo.kwh != null && !consumoKwhValido(consumo.kwh)) {
    console.warn('[engine] consumoKwh fora de faixa, descartado:', consumo.kwh)
    consumo = { ...consumo, kwh: undefined }
  }
  if (consumo.reais != null && !contaReaisValida(consumo.reais)) {
    console.warn('[engine] billValue fora de faixa, descartado:', consumo.reais)
    consumo = { ...consumo, reais: undefined }
  }

  // Quando vêm os dois (kWh + valor real da fatura), usa kWh para o sistema
  let solar = consumo.kwh ? calcularSolarPorKwh(consumo.kwh)
            : consumo.reais ? calcularSolar(consumo.reais)
            : null

  // Preserva o valor real da fatura quando temos ambos (ex: PDF/foto)
  if (solar && consumo.kwh && consumo.reais && consumo.reais > consumo.kwh) {
    solar = { ...solar, contaReais: Math.round(consumo.reais) }
  }
  // 🔋 HÍBRIDO (regra do dono, 2026-11-11): cliente pediu equipamento híbrido/com bateria → fórmula × 240%.
  //    O pedido fica guardado no lead (vale para os próximos orçamentos dele também).
  const querHibrido = await (await import('./hibrido')).leadQuerHibrido(lead.id, conversation.id, text)
  if (querHibrido) lead.customFields = { ...((lead.customFields as Record<string, unknown> | null) ?? {}), hibrido: true } as Prisma.JsonObject
  if (solar && querHibrido) solar = aplicarHibrido(solar)
  const consumoClienteKwh = solar?.consumoKwh ?? null
  let kitMinimo = false

  // Monta a orientação de cálculo pra IA (orçamento normal OU kit mínimo p/ consumo baixo)
  let estimate: string | undefined
  if (solar) {
    if (solar.baixoConsumo) {
      kitMinimo = true
      const kit = calcularSolarPorKwh(MINIMO_KIT_KWH)   // menor kit (250 kWh)
      estimate = `O consumo do cliente (~${consumoClienteKwh} kWh/mês) é abaixo de ${MINIMO_KIT_KWH} kWh. ` +
        `O orçamento usa o MENOR KIT disponível (${MINIMO_KIT_KWH} kWh). ` +
        `O orçamento formatado JÁ FOI ENVIADO — NÃO repita os números nem descreva a conta. ` +
        `Apenas diga naturalmente que esse é o menor kit disponível e pergunte se ficou alguma dúvida.`
      // Aplica o preço fixo do kit mínimo e recalcula parcelas/economia com esse valor
      const { calcularCore: _ignore, ...kitBase } = kit as typeof kit & { calcularCore?: unknown }
      void _ignore
      solar = { ...kit, valorSistema: MINIMO_KIT_PRECO }
      // Recalcula financiamento e payback com o preço real do kit mínimo, usando a tabela
      // ATIVA do banco (carência 120 dias + IOF + seguro embutidos no fator).
      const { getTabelaFinanciamento, parcelaFinanciamento } = await import('./solar-calc')
      const tabela = getTabelaFinanciamento()
      const taxas = Object.keys(tabela).map(Number).sort((a, b) => a - b)
        .map((prazo) => ({
          prazo,
          taxa: tabela[prazo].taxa,
          parcela: Math.round(parcelaFinanciamento(MINIMO_KIT_PRECO, prazo) * 100) / 100,
        }))
      const menorParcela = Math.min(...taxas.map((f) => f.parcela))
      solar = {
        ...solar,
        valorSistema: MINIMO_KIT_PRECO,
        financiamento: taxas,
        menorParcela,
        paybackAnos: solar.economiaAnual > 0 ? Math.round((MINIMO_KIT_PRECO / solar.economiaAnual) * 10) / 10 : 0,
        economiaImediata: Math.max(0, Math.round((solar.contaReais - menorParcela) * 100) / 100),
      }
      // OBS: no kit mínimo NÃO sobrescrevemos a conta pela do cliente — usamos os números do
      // kit de 250 kWh (consistentes). Senão a economia ficaria MAIOR que a conta (ex.: conta
      // R$120 com economia R$244). A IA explica que esse é o menor kit disponível.
    } else {
      estimate = resumoParaIA(solar)
    }
  }

  // Cliente reclama que NÃO recebeu / pede o orçamento DE NOVO, mas JÁ TEM orçamento salvo →
  // avisa que já está pronto e REENVIA o orçamento anterior (em vez de só pedir desculpas).
  const cfResend = (lead.customFields as Record<string, unknown> | null) ?? {}
  const storedSolarResend = cfResend.solar as Parameters<typeof orcamentoTexto>[0] | undefined
  if (!solar && storedSolarResend && !lead.humanOnly) {
    const txtR2 = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const reclama = /(nao recebi|nao chegou|nao veio|ningu[eé]m (me )?respond|nao (me )?respond|manda(r)?( de)? novo|reenvi|cad[eê].*or[çc]amento|pedi.*or[çc]amento|or[çc]amento.*(nao|ningu)|(duas|tr[eê]s|v[aá]rias) vezes)/.test(txtR2)
    if (reclama) {
      const { dispatchOutbound } = await import('./flow')
      const intro = 'Olha, seu orçamento já está pronto sim! 😊 Desculpa se não chegou direitinho antes — segue ele novamente pra você:'
      await simularDigitacao(intro)
      await dispatchOutbound(conversation.id, intro, undefined, 'ai')
      await new Promise((r) => setTimeout(r, 1500))
      await dispatchOutbound(conversation.id, orcamentoTexto(storedSolarResend), undefined, 'ai')
      await prisma.lead.update({ where: { id: lead.id }, data: { lastMessageAt: new Date() } })
      return { ...base, aiHandled: true }
    }
  }

  // prompt da etapa sobrescreve o do funil quando preenchido
  // Base de conhecimento: vale SEMPRE — inclusive depois do orçamento, quando surgem as dúvidas de
  // cartão, visita, pagamento (regra do dono, 2026-11-05). Se o orçamento for enviado, ele substitui a resposta.
  const learned = (await (await import('./learning')).buscarConhecimento(text)) || undefined

  const result = await runAgent(history, {
    botName:   fullPipeline?.botName,
    botPrompt: currentStage?.botPrompt || fullPipeline?.botPrompt,
    model:     fullPipeline?.aiModel,
    estimate,
    learned,
    lead: (lead.customFields as Record<string, unknown> | null) ?? null,
    stageName: currentStage?.name ?? null,
  })

  // 🙋 Pedido para falar com o DONO / RESPONSÁVEL (regra do dono, 2026-11-10): SEMPRE vai para
  //    atendimento humano com prioridade — não depende da IA lembrar de marcar o handoff.
  //    (Aviso só pelo Inbox/push do CRM, sem WhatsApp para o dono.)
  const normDono = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const pedeDono = /\b(falar|conversar|contato|contatar|telefone|numero|whats(app)?|ligar)\b.{0,40}\b(dono|donos|responsavel|gerente|proprietari\w*|diretor|socio)\b/.test(normDono)
    || /\b(dono|responsavel|gerente|proprietari\w*)\b.{0,30}\b(urgen\w*|urgente)\b/.test(normDono)
  if (pedeDono && !/\b(vend|ofere[cç]|parceri|fornec|revend|represent)\w*/.test(normDono)) {
    result.handoff = true
    result.highPriority = true
    result.discardLead = false
  }

  // 📚 Pedido de ebook/guia → envia o PDF Anti-Cilada automaticamente
  const normEbook = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const isEbookRequest = /(e-?book|guia|material|apostila|anti.?cilada|manual.*solar|pdf|catalogo)/.test(normEbook)
  if (isEbookRequest && (aiOn || stageAuto)) {
    const { dispatchOutbound } = await import('./flow')
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://kerosolar-crm-production.up.railway.app').replace(/\/$/, '')
    const ebookUrl = `${appUrl}/downloads/ebook-kerosolar.pdf`
    const nomeCliente = contact.name ? ` ${contact.name.split(' ')[0]}` : ''
    const ebookMsg = result.reply || `Aqui está${nomeCliente}! 😊 Preparei esse guia exclusivo pra você entender tudo sobre energia solar e não cair em armadilhas do mercado. Qualquer dúvida, é só me chamar! ☀️`
    await simularDigitacao(ebookMsg)
    await dispatchOutbound(conversation.id, ebookMsg, undefined, 'ai')
    // Envia o PDF apenas em canais que suportam (WhatsApp — Cloud API)
    if (conversation.channel === 'whatsapp' && conversation.accountId) {
      try {
        const account = await prisma.whatsappAccount.findUnique({ where: { id: conversation.accountId } })
        let waId: string | null = null
        const cloudAccount = (account?.provider === 'cloud' && account.cloudPhoneNumberId)
          ? account
          : await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
        if (cloudAccount?.cloudPhoneNumberId) {
          const toPhone = contact.whatsappId || contact.phone || conversation.externalId || ''
          if (toPhone) {
            const cloud = await import('./cloud-api')
            waId = await cloud.sendCloudMedia(cloudAccount.cloudPhoneNumberId, toPhone, ebookUrl, 'document', 'Guia-Anti-Cilada-KeroSolar-2026.pdf')
          }
        }
        await prisma.message.create({ data: { conversationId: conversation.id, direction: 'outbound', senderType: 'ai', content: '[📄 Guia Anti-Cilada KeroSolar 2026.pdf]', mediaUrl: ebookUrl, mediaType: 'document', ...(waId ? { externalId: waId } : {}) } })
      } catch (e) { console.error('[engine] ebook sendMedia', e) }
    }
    return { ...base, reply: null, aiHandled: true }
  }

  // Spam/oferta de produto a nós → responde, move para "Leads adquiridos" e fecha conversa
  if (result.discardLead) {
    const leadsAdqStage = await prisma.stage.findFirst({
      where: { name: { contains: 'adquiridos', mode: 'insensitive' }, pipelineId: lead.pipelineId },
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'open', aiEnabled: false, closedAt: now, stageId: leadsAdqStage?.id ?? lead.stageId },
    })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false, resolvedAt: now } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Descartado: oferta/spam — movido para "${leadsAdqStage?.name ?? 'Leads adquiridos'}" e conversa encerrada.` } })
    await simularDigitacao(result.reply)
    await prisma.message.create({ data: { conversationId: conversation.id, direction: 'outbound', senderType: 'ai', content: result.reply } })
    return { ...base, reply: result.reply, aiHandled: true }
  }

  // Se o regex não pegou mas a IA extraiu a conta/consumo, calcula a partir dela
  // (também passa pela trava de faixa — a IA pode ter lido um número errado do PDF).
  if (!solar) {
    if (consumoKwhValido(result.qualification.consumoKwh)) solar = calcularSolarPorKwh(result.qualification.consumoKwh)
    else if (contaReaisValida(result.qualification.billValue)) solar = calcularSolar(result.qualification.billValue)
    if (solar && querHibrido) solar = aplicarHibrido(solar)
  }

  // 5.5) Cliente reclamou / não quer mais receber → agradece (a própria reply) e entra na BLACK LIST.
  if (result.optOut) {
    const { dispatchOutbound } = await import('./flow')
    await simularDigitacao(result.reply)
    await dispatchOutbound(conversation.id, result.reply, undefined, 'ai') // manda o agradecimento ANTES de bloquear
    const numero = contact.phone || contact.whatsappId || conversation.externalId
    if (numero) { const { addNaLista } = await import('./lists'); await addNaLista(numero, 'no_send', 'Cliente pediu para não receber mais (opt-out / reclamação).') }
    await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, done: false }, data: { done: true } }) // cancela automações pendentes
    await prisma.lead.update({ where: { id: lead.id }, data: { aiEnabled: false, humanOnly: true } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: '🚫 Cliente pediu para NÃO receber mais mensagens — adicionado à black list (opt-out).' } })
    // dispatchOutbound já enviou pelo WhatsApp — reply: null evita duplo envio via sendText
    return { ...base, reply: null, aiHandled: true }
  }

  // 6) Aplica no CRM
  const contactUpdate: Prisma.ContactUncheckedUpdateInput = {}
  if (result.contact.name && !contact.name)   contactUpdate.name  = result.contact.name
  if (result.contact.email && !contact.email) contactUpdate.email = result.contact.email
  if (Object.keys(contactUpdate).length) {
    await prisma.contact.update({ where: { id: contact.id }, data: contactUpdate })
  }

  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
  const q  = result.qualification
  const merged: Record<string, unknown> = {
    ...cf,
    ...(q.billValue != null      ? { billValue: q.billValue }           : {}),
    ...(q.propertyType           ? { propertyType: q.propertyType }     : {}),
    ...(q.roofType               ? { roofType: q.roofType }             : {}),
    ...(q.isDecisionMaker != null ? { isDecisionMaker: q.isDecisionMaker } : {}),
    ...(result.contact.city      ? { city: result.contact.city }        : {}),
    ...(result.contact.state     ? { state: result.contact.state }      : {}),
  }
  // Resultado do simulador solar → guarda no lead pra aparecer no card
  if (solar) {
    merged.billValue = solar.contaReais
    merged.consumoKwh = consumoClienteKwh ?? solar.consumoKwh   // consumo REAL do cliente
    merged.solar = { ...solar, kitMinimo }   // resultado completo (kit mínimo quando consumo baixo)
  }

  const leadUpdate: Prisma.LeadUncheckedUpdateInput = { customFields: merged as Prisma.InputJsonValue }
  // valor do lead = valor do sistema calculado (ou o que a IA estimou)
  if (solar) leadUpdate.value = solar.valorSistema
  else if (result.estimatedValue != null) leadUpdate.value = result.estimatedValue
  if (result.contact.name && lead.title === `Lead ${channel}`) leadUpdate.title = result.contact.name

  // ⚡ Prioridade total: Grupo A / paga demanda (detecção por palavra-chave) OU IA sinalizou
  const txtNorm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const grupoA = /\bgrupo a\b|alta tens|media tens|demanda contratada|pag\w* demanda|\bdemanda\b/.test(txtNorm)

  // 🚗 Carro elétrico / wallbox → cliente prioritário, encaminha ao setor
  const carroEletrico = /carro eletric|veiculo eletric|carro hibrido|\bwallbox\b|recarga (veicular|do carro|do veiculo)|carregar.{0,15}carro|gerar.{0,15}(o |para o |pro )?carro|eletroposto/.test(txtNorm)
  if (carroEletrico && !lead.highPriority) {
    leadUpdate.highPriority = true
    await prisma.task.create({ data: { leadId: lead.id, title: '🚗 Encaminhar ao SETOR de carro elétrico / wallbox', type: 'call', dueAt: now } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'Interesse em carro elétrico/wallbox — cliente prioritário, encaminhado ao setor.' } })
  }
  if ((result.highPriority || grupoA) && !lead.highPriority) {
    leadUpdate.highPriority = true
    await prisma.task.create({ data: { leadId: lead.id, title: '⚡ PRIORIDADE: cliente Grupo A/demanda ou pronto pra fechar', type: 'call', dueAt: now } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: grupoA ? 'Cliente de alta tensão/demanda (Grupo A) — prioridade total.' : 'Forte intenção de fechamento — prioridade total.' } })
  }

  // ❄️ Pedido de ar-condicionado adicional → guarda, SINALIZA pra revisão, e
  //    agenda fallback de 30 min (se o cliente não informar as horas).
  //    Detecta por regex (confiável) com fallback pro campo estruturado da IA.
  const { extrairAc } = await import('./ac-calc')
  const acDet = extrairAc(text) ?? (result.acRequest && (result.acRequest.btu || result.acRequest.units)
    ? { units: result.acRequest.units ?? 1, btu: result.acRequest.btu ?? null, hoursPerDay: result.acRequest.hoursPerDay ?? null }
    : null)
  const prevAc = (cf.ac as { units?: number; btu?: number | null; hoursPerDay?: number | null } | undefined)
  // acIntent: cliente mencionou querer instalar/usar mais ar-condicionado. Enquanto não temos
  // BTU + horas, NÃO mandamos o orçamento simples (ficaria subdimensionado, ignorando os ares):
  // perguntamos os dados e sinalizamos pra revisão. (Ver bloco de outboundText abaixo.)
  let acIntent = false
  let acData: { units: number; btu: number | null; hoursPerDay: number | null } | null = null
  if (acDet) {
    acIntent = true
    // Junta com o que já sabíamos do AC (ex: BTU veio antes, horas agora)
    const ac = {
      units: acDet.units ?? prevAc?.units ?? 1,
      btu: acDet.btu ?? prevAc?.btu ?? null,
      hoursPerDay: acDet.hoursPerDay ?? prevAc?.hoursPerDay ?? null,
    }
    merged.ac = ac
    acData = ac
    leadUpdate.customFields = merged as Prisma.InputJsonValue

    // Só sinaliza/agenda quando já temos BTU (pedido concreto)
    if (ac.btu) {
      // Sinaliza pra revisão apenas na 1ª vez (não recria task a cada mensagem)
      if (!prevAc?.btu) {
        leadUpdate.highPriority = true
        await prisma.task.create({ data: { leadId: lead.id, title: '❄️ REVISAR orçamento com ar-condicionado e interpelar cliente', type: 'call', dueAt: now } })
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `Cliente quer instalar AC (${ac.units}x ${ac.btu} BTU) — orçamento marcado para sua revisão.` } })
      }
      // Reagenda o fallback conforme as horas (não agenda no simulador)
      if (!isSimulator) {
        await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: 'ac_followup', done: false }, data: { done: true } })
        if (ac.hoursPerDay == null) {
          await prisma.scheduledAction.create({
            data: {
              leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId,
              type: 'ac_followup',
              payload: { units: ac.units, btu: ac.btu } as object,
              runAt: new Date(Date.now() + 30 * 60 * 1000),
            },
          })
        }
      }
    }
  }

  // (Simulação de cartão / financiamento / entrada é tratada no bloco unificado acima, que
  //  responde e retorna antes de chegar aqui.)

  // Roteamento por NOME da etapa: a IA escolhe, com backup por palavra-chave (garantido)
  let routeName: string | null = result.routeToStage
  if (!routeName) {
    if (/vou (te )?(enviar|mandar)|te mando|vou mandar|mando (a|minha|uma foto)|envi\w* (a|minha) conta|mandar a foto|enviar a foto/.test(txtNorm) && /conta|fatura|foto/.test(txtNorm))
      routeName = 'Ficou de enviar a conta'
    else if (/ja sou cliente|ja instalei|ja comprei com voc|sou cliente de voc|ja tenho sistema com voc/.test(txtNorm))
      routeName = 'Já é cliente'
    // Orçamento calculado automaticamente nesta interação → move pra "Recebeu orçamento automático".
    // Inclui o KIT MÍNIMO (consumo baixo) — o kit de entrada também é um orçamento recebido.
    // (Não move quando há pedido de ar-condicionado pendente: ainda não enviamos orçamento.)
    else if (solar && !acIntent)
      routeName = 'Recebeu orçamento automático'
  }
  let movedToStageId: string | null = null
  if (routeName) {
    const alvo = norm(routeName)
    const target = pipeline.stages.find((s) => norm(s.name) === alvo)
    if (target && target.id !== lead.stageId) {
      leadUpdate.stageId = target.id
      movedToStageId = target.id
      await prisma.note.create({
        data: { leadId: lead.id, type: 'stage_change', content: `IA moveu para "${target.name}".` },
      })
      // Notifica o dono quando cliente entra em etapa de fechamento/financiamento
      const ehFechamento = /financiamento|pedido.*doc|vistoria.*agend/i.test(target.name)
      if (ehFechamento) {
        const { notificarDono } = await import('./flow')
        const nomeAlerta = contact.name || contact.phone || conversation.externalId || 'cliente'
        await notificarDono(`🔥 *FECHAMENTO — PRIORIDADE MÁXIMA*\n\nO cliente *${nomeAlerta}* quer prosseguir e foi movido para *"${target.name}"*!\n\n➡️ Acesse o CRM agora para dar continuidade.`).catch(() => {})
      }
    }
  }
  if (result.lost) { leadUpdate.status = 'lost'; leadUpdate.closedAt = now; if (result.lostReason) leadUpdate.lossReason = result.lostReason }

  // Orçamento NOVO calculado nesta interação → envia o orçamento DETERMINÍSTICO.
  // Inclui o kit mínimo (300 kWh): sempre mostra o orçamento formatado, nunca deixa a IA descrever.
  const consumoAntes = typeof cf.consumoKwh === 'number' ? cf.consumoKwh : null
  // Só (re)apresenta o orçamento se for o PRIMEIRO ou se o consumo mudou de forma RELEVANTE
  // (> 5% ou > 20 kWh). Evita reenviar um orçamento quase idêntico (ex.: 538 → 531) quando o
  // cliente manda a conta confirmando praticamente o mesmo consumo.
  const mudancaRelevante = consumoAntes == null
    || Math.abs((solar?.consumoKwh ?? 0) - consumoAntes) > Math.max(20, consumoAntes * 0.05)
  // acIntent suprime o orçamento automático: com pedido de ar-condicionado o cálculo precisa
  // incluir os ares (consumo futuro) — então perguntamos os dados e um humano revisa, em vez
  // de mandar um orçamento subdimensionado no consumo atual.
  // Conta NOVA lida agora (foto/PDF) → sempre apresenta o orçamento dela (pode ser outra conta do cliente).
  const presentBudget = !!solar && (mudancaRelevante || contaNovaLida) && !acIntent

  // Quando a IA detecta pedido de humano, usa a mensagem PADRÃO de transferência
  // EXCEÇÃO: quando a IA já tem uma mensagem específica de contexto (pós-venda, financiamento etc.)
  //          nesse caso preservamos a reply da IA — ela já diz o certo pro cliente.
  // 🕒 nunca "Bom dia" às 17h: corrige o cumprimento da IA pelo horário de Brasília
  let outboundText = presentBudget && solar ? orcamentoTexto(solar) : corrigirCumprimento(result.reply)
  let outboundSender: 'ai' | 'system' = 'ai'
  if (result.handoff) {
    // pedido para falar com o dono: mantém a resposta acolhedora da IA (já diz que avisou o responsável)
    // no modo "Henrique" também: a resposta dele ("vou verificar e te respondo em breve") é a que sai
    const modoHenrique = !!((lead.customFields as Record<string, unknown> | null)?.personaHenrique)
    const isPosSale = pedeDono || modoHenrique || /te respondo em breve|recebeu|encaminhando|consultor.*retorn|vou enviar.*video|foto.*inversor|conta.*encaminh/i.test(result.reply)
    if (!isPosSale) {
      // Handoff genérico (cliente pediu humano, caso complexo etc.) → mensagem padrão
      const { getHandoffMessage } = await import('./handoff')
      outboundText = await getHandoffMessage()
      outboundSender = 'system'
    }
    // Em ambos os casos: desativa IA, cria tarefa e nota
    leadUpdate.aiEnabled = false
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    // Título da tarefa contextual conforme a etapa atual
    const stageNome = pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? ''
    const taskTitle = /ja.*cliente|already/i.test(stageNome)
      ? '🔧 Atendimento pós-venda — continuar atendimento'
      : 'Cliente pediu atendimento humano'
    await prisma.task.create({
      data: { leadId: lead.id, title: taskTitle, type: 'message', dueAt: now },
    })
    await prisma.note.create({
      data: { leadId: lead.id, type: 'system', content: 'IA encaminhou para atendimento humano — IA desativada.' },
    })
    // 🔔 Precisa de você: push com vibração/som mais insistente.
    if (!isSimulator) {
      const { enviarPush } = await import('./push')
      enviarPush({
        title: `🙋 ${contact.name || contact.phone || 'Cliente'} precisa de atendimento`,
        body: taskTitle,
        url: `/leads/${lead.id}`,
        tag: conversation.id,
        attention: true,
      }).catch(() => {})
    }
  }

  // ❄️ AR-CONDICIONADO: cliente quer instalar/usar mais ar. NÃO mandamos o orçamento simples
  //    (subdimensionado). Sem BTU+horas → pedimos os dados. Com tudo → confirmamos que vamos
  //    preparar o projeto considerando os ares (um humano revisa o cálculo com o AC incluído).
  if (acIntent && !result.handoff) {
    const completo = !!(acData?.btu && acData?.hoursPerDay != null)
    if (completo) {
      const qtd = (acData?.units ?? 1)
      outboundText = `Perfeito! 😊 Vou preparar um projeto já considerando ${qtd > 1 ? `os ${qtd} ar-condicionados` : 'o ar-condicionado'}${acData?.btu ? ` de ${acData.btu.toLocaleString('pt-BR')} BTU` : ''} — assim o sistema cobre o consumo de hoje + o dos ares. Já te retorno com os números certinhos!`
    } else {
      const faltaBtu = !acData?.btu
      const faltaHoras = acData?.hoursPerDay == null
      const pede = [
        faltaBtu ? '*quantos BTUs* cada um (ex.: 9.000, 12.000, 18.000)' : null,
        faltaHoras ? '*quantas horas por dia* pretende usar' : null,
      ].filter(Boolean).join(' e ')
      outboundText = `Que bom que vai colocar ar-condicionado! 😊 Pra eu dimensionar o sistema certinho — já incluindo os ares no cálculo — me diz ${pede || 'os detalhes dos aparelhos (quantidade, BTU e horas de uso por dia)'}?`
    }
    outboundSender = 'ai'
  }

  // Rede de segurança: IA nunca deixa o cliente sem resposta (reply vazio → fallback)
  if (!result.handoff && (!outboundText || !outboundText.trim())) {
    outboundText = 'Desculpa, não entendi bem 😅 Pode me explicar de outro jeito? Se preferir, me manda sua conta de luz que eu já te ajudo.'
  }

  // 🔒 ANTI-LOOP (regra universal: nunca repetir mensagem). Detecta dois tipos:
  // 1) Repetição EXATA: IA vai mandar exatamente o que já mandou → passa pro humano.
  // 2) Loop SEMÂNTICO: as últimas 2 respostas da IA + a nova todas começam com as
  //    mesmas 5 palavras (ex.: "Sim estou aqui como posso") → IA travou num ciclo de
  //    variações do mesmo texto → passa pro humano imediatamente.
  if (!result.handoff && !presentBudget && outboundText?.trim()) {
    const normMsg = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const prefixOf = (s: string) => normMsg(s).split(' ').slice(0, 5).join(' ')
    const recentOut = await prisma.message.findMany({
      where: { conversationId: conversation.id, direction: 'outbound', senderType: { in: ['ai', 'system'] } },
      orderBy: { createdAt: 'desc' }, take: 2,
      select: { content: true },
    })
    const isExactRepeat  = recentOut.length > 0 && normMsg(recentOut[0].content) === normMsg(outboundText)
    // Loop semântico: 2 respostas anteriores + a nova TODAS compartilham o mesmo prefixo
    const isSemanticLoop = recentOut.length >= 2
      && prefixOf(outboundText) === prefixOf(recentOut[0].content)
      && prefixOf(outboundText) === prefixOf(recentOut[1].content)
    if (isExactRepeat || isSemanticLoop) {
      console.warn('[engine] IA travou em loop (exato ou semântico) → encaminhando ao humano')
      const { getHandoffMessage } = await import('./handoff')
      outboundText = await getHandoffMessage()
      outboundSender = 'system'
      leadUpdate.aiEnabled = false
      leadUpdate.highPriority = true
      await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
      await prisma.task.create({ data: { leadId: lead.id, title: '⚠️ IA travou em loop — assumir conversa', type: 'message', dueAt: now } })
      await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: isSemanticLoop ? 'IA travou em loop semântico (variações da mesma resposta) — encaminhado ao humano.' : 'IA ia repetir a mesma mensagem — encaminhado ao humano e IA desativada.' } })
      if (!isSimulator) {
        const { enviarPush } = await import('./push')
        enviarPush({
          title: `⚠️ ${contact.name || contact.phone || 'Cliente'} — assuma a conversa`,
          body: 'A IA travou e precisa de você.',
          url: `/leads/${lead.id}`,
          tag: conversation.id,
          attention: true,
        }).catch(() => {})
      }
    }
  }

  // Limpa agendamento pendente de confirmação quando cliente responde
  if (cf.pendingAppointmentId) {
    merged.pendingAppointmentId = null
    merged.pendingAppointmentAt = null
  }

  // Agendamento confirmado → salva na agenda e agenda lembrete 2h antes
  if (result.appointment?.scheduledAt) {
    try {
      const apptDate = new Date(result.appointment.scheduledAt)
      // Bloqueio determinístico de dia NÃO útil (fim de semana/feriado) — a IA não
      // calcula dia da semana de forma confiável, então validamos aqui.
      if (!isNaN(apptDate.getTime()) && apptDate > now && !ehDiaUtil(apptDate)) {
        outboundText = 'Ok, vou enviar a sua mensagem para o consultor e ver com ele a disponibilidade de agendar nesse dia que não é dia útil. Te respondo assim que ele confirmar! Mas caso queira agendar para um dia útil, é só me passar 😊'
        outboundSender = 'ai'
        leadUpdate.highPriority = true
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `⚠️ Cliente pediu agendamento em dia NÃO útil (${apptDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}). Encaminhado ao consultor.` } })
      } else if (!isNaN(apptDate.getTime()) && apptDate > now) {
        const contactName = contact.name ?? lead.title
        const channelLabel = result.appointment.channel === 'phone' ? 'Ligação' : result.appointment.channel === 'video' ? 'Videochamada' : 'WhatsApp'
        const appt = await prisma.appointment.create({
          data: {
            leadId: lead.id,
            title: `${channelLabel} — ${contactName}`,
            scheduledAt: apptDate,
            channel: result.appointment.channel,
            notes: result.appointment.notes ?? null,
          },
        })
        await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: `📅 Agendamento criado: ${channelLabel} em ${apptDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` } })
        // Confirmação 1 dia antes + lembrete 2h antes (só agenda se houver tempo — desativado no simulador)
        if (!isSimulator) {
          const confirmAt = new Date(apptDate.getTime() - 24 * 60 * 60 * 1000)  // 1 dia antes: pede confirmação
          const reminderAt = new Date(apptDate.getTime() - 3 * 60 * 60 * 1000)  // 3h antes: lembrete final
          for (const runAt of [confirmAt, reminderAt]) {
            if (runAt > now) {
              await prisma.scheduledAction.create({
                data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'appointment_reminder', payload: { appointmentId: appt.id } as object, runAt },
              })
            }
          }
        }
      }
    } catch (e) { console.error('[appointment save]', e) }
  }

  await prisma.lead.update({ where: { id: lead.id }, data: leadUpdate })

  // Regra do negócio: NUNCA "travar"/prometer ação futura ("um momento", "vou calcular").
  // O orçamento sai DIRETO, sem frase de espera — só simula a digitação proporcional ao texto.
  // 🔁 NUNCA REPETIR A MESMA RESPOSTA: se a IA gerou exatamente o que já foi enviado há pouco,
  //    em vez de repetir pede para o cliente refazer a pergunta (regra do dono).
  //    (2026-11-12: compara com TODA a conversa e pega também resposta "quase igual", não só idêntica)
  if (!presentBudget && outboundText) {
    const ult = await prisma.message.findMany({ where: { conversationId: conversation.id, direction: 'outbound' }, orderBy: { createdAt: 'desc' }, take: 40, select: { content: true } })
    const { repeteAlguma } = await import('./repeticao')
    if (repeteAlguma(outboundText, ult.map((m) => m.content ?? ''))) {
      console.log('[engine] resposta repetida bloqueada — pedindo para refazer a pergunta')
      outboundText = 'Não entendi bem sua pergunta 🤔 Pode refazer de outro jeito pra eu te responder certinho?'
    }
  }

  await simularDigitacao(outboundText)

  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'outbound', senderType: outboundSender, content: outboundText },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })

  // Após o orçamento: agenda follow-up (~90s) — desativado no simulador
  if (presentBudget && !isSimulator) {
    await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: 'budget_followup', done: false }, data: { done: true } })
    await prisma.scheduledAction.create({
      data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'budget_followup', payload: { step: 1 } as object, runAt: new Date(Date.now() + 5 * 60 * 1000) },
    })
  }

  // Mudou de etapa? Dispara a "chamada" (fluxo) da nova etapa.
  if (movedToStageId) {
    const { enterStage } = await import('./flow')
    await enterStage(lead.id, movedToStageId).catch((e) => console.error('[enterStage]', e))
  } else if (!result.handoff && !isSimulator) {
    // Continua na mesma etapa (IA conduzindo) → agenda checagem "sem resposta" se a etapa tiver
    // (desativado no simulador para não interferir nos testes)
    const stageNow = await prisma.stage.findUnique({ where: { id: lead.stageId } })
    const nr = (stageNow?.flow as { noReply?: { minutes?: number } } | null)?.noReply
    if (nr?.minutes && nr.minutes > 0) {
      const { scheduleNoReply } = await import('./flow-blocks')
      await scheduleNoReply(lead.id, conversation.id, lead.stageId).catch(() => {})
    }
    // CHEGADA: lead que CONVERSOU mas NÃO converteu (sem orçamento, sem mudar de etapa) →
    // após 2h de silêncio manda follow-up; se continuar mudo, vai pra Repescagem (não pra "Não respondeu").
    if (/chegada/i.test(stageNow?.name ?? '') && !presentBudget) {
      await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: 'chegada_followup', done: false }, data: { done: true } })
      await prisma.scheduledAction.create({
        data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'chegada_followup', payload: { step: 1 } as object, runAt: new Date(Date.now() + 2 * 60 * 60 * 1000) },
      }).catch(() => {})
    }
  }

  const finalStage = movedToStageId
    ? pipeline.stages.find((s) => s.id === movedToStageId)?.name ?? base.stage
    : pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? base.stage

  return { ...base, reply: outboundText, aiHandled: true, handoff: result.handoff, stage: finalStage }
}
