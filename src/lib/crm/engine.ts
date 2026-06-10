import 'server-only'
import { Prisma } from '@prisma/client'
import type { Channel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
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
  mediaUrl?: string | null       // anexo do cliente salvo (para visualizar no chat)
  mediaType?: 'image' | 'video' | 'document' | null
}

export type IngestResult = {
  contactId: string
  conversationId: string
  leadId: string
  reply: string | null
  aiHandled: boolean
  handoff: boolean
  stage: string
}

export async function ingestMessage(input: IngestInput): Promise<IngestResult> {
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
  if (conversation.leadId !== lead.id) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id }, data: { leadId: lead.id },
    })
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
    },
  })
  // Cliente escreveu → reabre a conversa no Inbox (zera o "fechado pelo operador")
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now, resolvedAt: null } })
  await prisma.lead.update({ where: { id: lead.id }, data: { lastMessageAt: now } })
  // cliente respondeu → cancela checagens pendentes (sem-resposta e follow-up de orçamento)
  await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: { in: ['flow_noreply', 'budget_followup', 'chegada_followup'] }, done: false }, data: { done: true } })

  const base: IngestResult = {
    contactId: contact.id, conversationId: conversation.id, leadId: lead.id,
    reply: null, aiHandled: false, handoff: false,
    stage: pipeline.stages.find((s) => s.id === lead!.stageId)?.name ?? firstStage.name,
  }

  // Carrega config de IA do funil e da etapa atual
  const fullPipeline = await prisma.pipeline.findUnique({ where: { id: lead.pipelineId } })
  const currentStage = await prisma.stage.findUnique({ where: { id: lead.stageId } })

  // Bloqueio TOTAL: cliente já recusou bot antes → só humano, nenhuma automação
  if (lead.humanOnly) return base

  // 🕑 Operador respondendo manualmente? A IA AGUARDA 2 min de inatividade dele antes de
  //    voltar a responder (cada mensagem do operador reinicia o tempo). Vale tanto p/ respostas
  //    pelo CRM quanto pelo app do WhatsApp (ambas ficam como outbound 'human'). A mensagem do
  //    cliente já foi salva acima — só não acionamos nenhuma resposta automática agora.
  {
    const MS_INATIVIDADE = 2 * 60 * 1000
    const ultimaHumana = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'outbound', senderType: 'human' },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    })
    if (ultimaHumana && Date.now() - new Date(ultimaHumana.createdAt).getTime() < MS_INATIVIDADE) {
      console.log('[engine] operador ativo (<2min) → IA aguarda')
      return base
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
      return { ...base, reply: msg, aiHandled: true, stage: firstStage.name }
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

  // 4.32) Recepção fora do horário (a partir das 21h até 9h): pergunta se o
  //       cliente quer só deixar registrado ou prosseguir com o atendimento agora.
  if (aiOn || stageAuto) {
    const spHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
    // Fora do horário: das 21h às 06h (antes das 6h e a partir das 21h). Entre 6h e 9h já atende normal.
    const isAfterHours = spHour >= 21 || spHour < 6
    const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const { dispatchOutbound } = await import('./flow')

    if (!isAfterHours && (lead.afterHoursAsked || lead.afterHoursProceed)) {
      // voltou a ser horário comercial → reseta o estado
      await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: false, afterHoursProceed: false } })
      lead.afterHoursAsked = false; lead.afterHoursProceed = false
    }

    if (isAfterHours && !lead.afterHoursProceed) {
      const querDepois = /(so |apenas )?(registr|deixa registr|deixar registr|pode deixar|depois|amanha|horario comercial|outro dia|mais tarde)/.test(norm)
      const querAgora = /(prossegu|continu|agora|atende|atender|quero sim|pode seguir|vamos|sim quero|seguir)/.test(norm)
      // Lead que JÁ conversou (tem mensagens nossas) NÃO é novo → não recebe a pergunta de fora do horário
      const jaConversou = (await prisma.message.count({ where: { conversationId: conversation.id, direction: 'outbound' } })) > 0
      const saud = spHour >= 5 && spHour < 12 ? 'Bom dia' : spHour >= 12 && spHour < 18 ? 'Boa tarde' : 'Boa noite'

      if (querDepois) {
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: true } })
        const msg = `Perfeito! Deixei seu contato registrado e retomo no horário comercial (a partir das 9h). ${saud === 'Boa noite' ? 'Tenha uma ótima noite' : 'Até já'}! 😊`
        await simularDigitacao(msg)
        await dispatchOutbound(conversation.id, msg, undefined, 'ai')
        return { ...base, reply: msg, aiHandled: true }
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
        // primeira mensagem fora do horário → recepção + pergunta
        await prisma.lead.update({ where: { id: lead.id }, data: { afterHoursAsked: true } })
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'after_hours_message' } })
        const msg = (cfg?.value || `${saud}! Recebi sua mensagem 😊 Você prefere que eu já comece seu atendimento agora, ou quer só deixar registrado e a gente continua no horário comercial (a partir das 9h)?`).replace(/\{SAUDACAO\}/g, saud)
        await simularDigitacao(msg)
        await dispatchOutbound(conversation.id, msg, undefined, 'ai')
        return { ...base, reply: msg, aiHandled: true }
      }
    }
  }

  // 4.33) Cliente INICIAL em HORÁRIO COMERCIAL → manda a saudação COMPLETA, já pedindo a
  //       conta / consumo (kWh ou R$). Fora do horário (21h–06h) o bloco acima já tratou
  //       com a opção "agora ou depois". Só dispara no PRIMEIRO contato (ainda não respondemos)
  //       e quando o cliente AINDA não informou consumo na mensagem.
  if (aiOn || stageAuto) {
    const spHourC = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
    const horarioComercial = spHourC >= 6 && spHourC < 21
    const jaRespondemos = await prisma.message.count({ where: { conversationId: conversation.id, direction: 'outbound' } })
    const txtC = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const jaTemConsumo = /\d/.test(txtC) && /(kwh|kw\/h|quilowatt|r\$|reais|pain|placa|m[oó]dulo)/.test(txtC)
    if (horarioComercial && jaRespondemos === 0 && !jaTemConsumo && !lead.humanOnly) {
      const saud = spHourC < 12 ? 'Bom dia' : spHourC < 18 ? 'Boa tarde' : 'Boa noite'
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
      return { ...base, reply: msg, aiHandled: true }
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

  // 5) Agente IA
  const msgs = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' }, take: 40,
  })
  const history: ChatMessage[] = msgs.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }))
  // Se o cliente enviou uma imagem nesta mensagem, injeta no último item do histórico
  if (input.imageBase64 && history.length > 0) {
    const last = history[history.length - 1]
    if (last.role === 'user') {
      last.imageBase64    = input.imageBase64
      last.imageMediaType = input.imageMediaType ?? 'image/jpeg'
    }
  }

  // 4.7) Cálculo solar — extrai dados da mensagem ou da imagem (conta de luz)
  const { extrairConsumo, calcularSolar, calcularSolarPorKwh, resumoParaIA, orcamentoTexto, MINIMO_KIT_KWH, MINIMO_KIT_PRECO, consumoKwhValido, contaReaisValida } = await import('./solar-calc')
  let consumo = extrairConsumo(text)

  // Se veio imagem → extrai via visão da IA (conta de luz OU detecta documento de identidade)
  let billData: Awaited<ReturnType<typeof extractBillFromImage>> | null = null
  if (input.imageBase64 && !consumo.kwh && !consumo.reais) {
    const aiCfg = await loadAiConfig()
    billData = await extractBillFromImage(aiCfg, input.imageBase64, input.imageMediaType ?? 'image/jpeg')
    if (billData.kwh)             consumo = { kwh: billData.kwh }
    else if (billData.paineis)    consumo = { kwh: billData.paineis * 60 }  // 1 painel = 60 kWh
    else if (billData.valor)      consumo = { reais: billData.valor }
    if (billData.medidor || billData.distribuidora) {
      const billInfo = [billData.medidor, billData.distribuidora].filter(Boolean).join(' | ')
      text = `${text}\n[Dados lidos da foto: ${billInfo}]`.trim()
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
      // Recalcula financiamento e payback com o preço real do kit mínimo
      const { TAXAS_FINANCIAMENTO } = await import('./solar-calc')
      const taxas = Object.keys(TAXAS_FINANCIAMENTO).map(Number).sort((a, b) => a - b)
        .map((prazo) => {
          const taxa = TAXAS_FINANCIAMENTO[prazo] / 100
          const parcela = MINIMO_KIT_PRECO * (taxa * Math.pow(1 + taxa, prazo)) / (Math.pow(1 + taxa, prazo) - 1)
          return { prazo, taxa: TAXAS_FINANCIAMENTO[prazo], parcela: Math.round(parcela * 100) / 100 }
        })
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
  // Base de conhecimento: só busca quando NÃO vamos entregar orçamento (aí a resposta é
  // conversacional e pode se beneficiar das respostas anteriores da equipe).
  const learned = solar ? undefined : await (await import('./learning')).buscarConhecimento(text)

  const result = await runAgent(history, {
    botName:   fullPipeline?.botName,
    botPrompt: currentStage?.botPrompt || fullPipeline?.botPrompt,
    model:     fullPipeline?.aiModel,
    estimate,
    learned,
    lead: (lead.customFields as Record<string, unknown> | null) ?? null,
  })

  // Spam/oferta de produto a nós → responde e descarta (não mantém ativo no CRM)
  if (result.discardLead) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'lost', aiEnabled: false, closedAt: now } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'Descartado: oferta/spam (não mantido no funil ativo).' } })
    await simularDigitacao(result.reply)
    await prisma.message.create({ data: { conversationId: conversation.id, direction: 'outbound', senderType: 'ai', content: result.reply } })
    return { ...base, reply: result.reply, aiHandled: true }
  }

  // Se o regex não pegou mas a IA extraiu a conta/consumo, calcula a partir dela
  // (também passa pela trava de faixa — a IA pode ter lido um número errado do PDF).
  if (!solar) {
    if (consumoKwhValido(result.qualification.consumoKwh)) solar = calcularSolarPorKwh(result.qualification.consumoKwh)
    else if (contaReaisValida(result.qualification.billValue)) solar = calcularSolar(result.qualification.billValue)
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
    return { ...base, reply: result.reply, aiHandled: true }
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
  if (acDet) {
    // Junta com o que já sabíamos do AC (ex: BTU veio antes, horas agora)
    const ac = {
      units: acDet.units ?? prevAc?.units ?? 1,
      btu: acDet.btu ?? prevAc?.btu ?? null,
      hoursPerDay: acDet.hoursPerDay ?? prevAc?.hoursPerDay ?? null,
    }
    merged.ac = ac
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

  // Roteamento por NOME da etapa: a IA escolhe, com backup por palavra-chave (garantido)
  let routeName: string | null = result.routeToStage
  if (!routeName) {
    if (/vou (te )?(enviar|mandar)|te mando|vou mandar|mando (a|minha|uma foto)|envi\w* (a|minha) conta|mandar a foto|enviar a foto/.test(txtNorm) && /conta|fatura|foto/.test(txtNorm))
      routeName = 'Ficou de enviar a conta'
    else if (/ja sou cliente|ja instalei|ja comprei com voc|sou cliente de voc|ja tenho sistema com voc/.test(txtNorm))
      routeName = 'Já é cliente'
    // Orçamento calculado automaticamente nesta interação → move pra "Recebeu orçamento automático"
    else if (solar && !kitMinimo)
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
  const presentBudget = !!solar && mudancaRelevante

  // Quando a IA detecta pedido de humano, usa a mensagem PADRÃO de transferência
  // EXCEÇÃO: quando a IA já tem uma mensagem específica de contexto (pós-venda, financiamento etc.)
  //          nesse caso preservamos a reply da IA — ela já diz o certo pro cliente.
  let outboundText = presentBudget && solar ? orcamentoTexto(solar) : result.reply
  let outboundSender: 'ai' | 'system' = 'ai'
  if (result.handoff) {
    const isPosSale = /recebeu|encaminhando|consultor.*retorn|vou enviar.*video|foto.*inversor|conta.*encaminh/i.test(result.reply)
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
  }

  // Rede de segurança: IA nunca deixa o cliente sem resposta (reply vazio → fallback)
  if (!result.handoff && (!outboundText || !outboundText.trim())) {
    outboundText = 'Desculpa, não entendi bem 😅 Pode me explicar de outro jeito? Se preferir, me manda sua conta de luz que eu já te ajudo.'
  }

  // 🔒 ANTI-LOOP (regra universal: nunca repetir mensagem). Se a IA vai responder
  // EXATAMENTE o que já respondeu por último, ela está travada → em vez de repetir,
  // passa pro humano (melhor não insistir do que mandar o mesmo texto de novo).
  if (!result.handoff && !presentBudget && outboundText?.trim()) {
    const normMsg = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const lastOut = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'outbound', senderType: { in: ['ai', 'system'] } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    if (lastOut && normMsg(lastOut.content) === normMsg(outboundText)) {
      console.warn('[engine] IA ia repetir a mesma mensagem → encaminhando ao humano')
      const { getHandoffMessage } = await import('./handoff')
      outboundText = await getHandoffMessage()
      outboundSender = 'system'
      leadUpdate.aiEnabled = false
      leadUpdate.highPriority = true
      await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
      await prisma.task.create({ data: { leadId: lead.id, title: '⚠️ IA travou (ia repetir) — assumir conversa', type: 'message', dueAt: now } })
      await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'IA ia repetir a mesma mensagem — encaminhado ao humano e IA desativada.' } })
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

  // Ao apresentar orçamento: avisa que está calculando e espera alguns segundos (toque humano)
  if (presentBudget && !result.handoff) {
    const { dispatchOutbound } = await import('./flow')
    await simularDigitacao('Ótimo! Deixa eu calcular aqui rapidinho pra você ⏳')
    await dispatchOutbound(conversation.id, 'Ótimo! Deixa eu calcular aqui rapidinho pra você ⏳', undefined, 'ai')
    await new Promise((r) => setTimeout(r, 6000))
  } else {
    // Resposta normal → simula digitação proporcional ao tamanho
    await simularDigitacao(outboundText)
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'outbound', senderType: outboundSender, content: outboundText },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })

  // Após o orçamento: agenda follow-up (~90s) — desativado no simulador
  if (presentBudget && !isSimulator) {
    await prisma.scheduledAction.updateMany({ where: { leadId: lead.id, type: 'budget_followup', done: false }, data: { done: true } })
    await prisma.scheduledAction.create({
      data: { leadId: lead.id, conversationId: conversation.id, stageId: lead.stageId, type: 'budget_followup', payload: { step: 1 } as object, runAt: new Date(Date.now() + 90 * 1000) },
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
