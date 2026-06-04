import 'server-only'
import { Prisma } from '@prisma/client'
import type { Channel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runAgent } from './agent'
import type { ChatMessage } from './ai'

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

function stageByKey<T extends { id: string; name: string; isLost: boolean; isWon: boolean }>(stages: T[], key: string) {
  const target = norm(DEFAULT_STAGES.find((s) => s.key === key)?.name ?? key)
  return stages.find((s) => norm(s.name) === target)
}

function channelIdField(ch: Channel): 'whatsappId' | 'instagramId' | 'facebookId' | null {
  if (ch === 'whatsapp')  return 'whatsappId'
  if (ch === 'instagram') return 'instagramId'
  if (ch === 'facebook')  return 'facebookId'
  return null
}

export type IngestInput = {
  channel: Channel
  externalId: string
  text: string
  name?: string | null
  phone?: string | null
  externalMessageId?: string | null
  pipelineId?: string | null   // funil de destino (roteamento por canal); default se ausente
  accountId?: string | null    // conta de WhatsApp que recebeu
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
  const { channel, externalId, text } = input
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
      data: { channel, contactId: contact.id, externalId, accountId: input.accountId ?? null },
    })
  } else if (input.accountId && conversation.accountId !== input.accountId) {
    conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: { accountId: input.accountId } })
  }

  // 3) Lead
  let lead = await prisma.lead.findFirst({
    where: { contactId: contact.id, status: 'open' },
    orderBy: { createdAt: 'desc' },
  })
  if (!lead) {
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

  // 4) Mensagem recebida
  const now = new Date()
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'inbound', senderType: 'contact', content: text, externalId: input.externalMessageId ?? null },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } })
  await prisma.lead.update({ where: { id: lead.id }, data: { lastMessageAt: now } })

  const base: IngestResult = {
    contactId: contact.id, conversationId: conversation.id, leadId: lead.id,
    reply: null, aiHandled: false, handoff: false,
    stage: pipeline.stages.find((s) => s.id === lead!.stageId)?.name ?? firstStage.name,
  }

  // Carrega config de IA do funil e da etapa atual
  const fullPipeline = await prisma.pipeline.findUnique({ where: { id: lead.pipelineId } })
  const currentStage = await prisma.stage.findUnique({ where: { id: lead.stageId } })

  // IA só responde se: lead ON + conversa ON + funil ON + etapa ON
  const aiOn = lead.aiEnabled && conversation.aiEnabled
    && (fullPipeline?.botEnabled ?? true)
    && (currentStage?.botEnabled ?? true)
  if (!aiOn) return base

  // 4.5) Cliente pediu humano / recusou o bot? → transfere na hora (sem chamar a IA)
  const { wantsHuman, performHandoff } = await import('./handoff')
  if (wantsHuman(text)) {
    const msg = await performHandoff(lead.id, conversation.id)
    return { ...base, reply: msg, aiHandled: true, handoff: true }
  }

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

  // prompt da etapa sobrescreve o do funil quando preenchido
  const result = await runAgent(history, {
    botName:   fullPipeline?.botName,
    botPrompt: currentStage?.botPrompt || fullPipeline?.botPrompt,
    model:     fullPipeline?.aiModel,
  })

  // 6) Aplica no CRM
  const contactUpdate: Prisma.ContactUncheckedUpdateInput = {}
  if (result.contact.name && !contact.name)   contactUpdate.name  = result.contact.name
  if (result.contact.email && !contact.email) contactUpdate.email = result.contact.email
  if (Object.keys(contactUpdate).length) {
    await prisma.contact.update({ where: { id: contact.id }, data: contactUpdate })
  }

  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
  const q  = result.qualification
  const merged = {
    ...cf,
    ...(q.billValue != null      ? { billValue: q.billValue }           : {}),
    ...(q.propertyType           ? { propertyType: q.propertyType }     : {}),
    ...(q.roofType               ? { roofType: q.roofType }             : {}),
    ...(q.isDecisionMaker != null ? { isDecisionMaker: q.isDecisionMaker } : {}),
    ...(result.contact.city      ? { city: result.contact.city }        : {}),
    ...(result.contact.state     ? { state: result.contact.state }      : {}),
  }

  const leadUpdate: Prisma.LeadUncheckedUpdateInput = { customFields: merged as Prisma.InputJsonValue }
  if (result.estimatedValue != null) leadUpdate.value = result.estimatedValue
  if (result.contact.name && lead.title === `Lead ${channel}`) leadUpdate.title = result.contact.name

  let targetKey: string | null = result.stageSuggestion
  if (result.lost) targetKey = 'perdido'

  let movedToStageId: string | null = null
  if (targetKey) {
    const target = stageByKey(pipeline.stages, targetKey)
    if (target && target.id !== lead.stageId) {
      leadUpdate.stageId = target.id
      movedToStageId = target.id
      if (target.isLost) {
        leadUpdate.status = 'lost'
        leadUpdate.closedAt = now
        if (result.lostReason) leadUpdate.lossReason = result.lostReason
      }
      await prisma.note.create({
        data: { leadId: lead.id, type: 'stage_change', content: `IA moveu para "${target.name}".` },
      })
    }
  }

  // Quando a IA detecta pedido de humano, usa a mensagem PADRÃO de transferência
  let outboundText = result.reply
  let outboundSender: 'ai' | 'system' = 'ai'
  if (result.handoff) {
    const { getHandoffMessage } = await import('./handoff')
    outboundText = await getHandoffMessage()
    outboundSender = 'system'
    leadUpdate.aiEnabled = false
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: false } })
    await prisma.task.create({
      data: { leadId: lead.id, title: 'Cliente pediu atendimento humano', type: 'message', dueAt: now },
    })
    await prisma.note.create({
      data: { leadId: lead.id, type: 'system', content: 'IA transferiu a conversa para humano — IA desativada.' },
    })
  }

  await prisma.lead.update({ where: { id: lead.id }, data: leadUpdate })
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'outbound', senderType: outboundSender, content: outboundText },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })

  // Mudou de etapa? Dispara a "chamada" (fluxo) da nova etapa.
  if (movedToStageId) {
    const { enterStage } = await import('./flow')
    await enterStage(lead.id, movedToStageId).catch((e) => console.error('[enterStage]', e))
  }

  const finalStage = targetKey
    ? stageByKey(pipeline.stages, targetKey)?.name ?? base.stage
    : pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? base.stage

  return { ...base, reply: outboundText, aiHandled: true, handoff: result.handoff, stage: finalStage }
}
