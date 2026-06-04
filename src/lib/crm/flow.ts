import 'server-only'
import { prisma } from '@/lib/prisma'

type FlowMsg = { text: string; delaySeconds: number; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }
type StageFlow = {
  openingMessages: FlowMsg[]
  handoffToAi: boolean
  keywordRules?: { keywords: string; targetStageId: string }[]
  noReplyMinutes?: number
  noReplyTargetStageId?: string
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Verifica se a mensagem do cliente contém alguma palavra-chave (ou variação)
 * configurada na etapa atual. Retorna a etapa de destino, se houver.
 */
export async function keywordTargetFor(stageId: string, text: string): Promise<string | null> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const flow = stage?.flow as StageFlow | null
  if (!flow?.keywordRules?.length) return null
  const t = normalize(text)
  for (const rule of flow.keywordRules) {
    if (!rule.targetStageId) continue
    const words = rule.keywords.split(',').map((w) => normalize(w.trim())).filter(Boolean)
    if (words.some((w) => w.length >= 2 && t.includes(w))) return rule.targetStageId
  }
  return null
}

/** Move o lead para uma etapa (uso por palavra-chave / manual), disparando a chamada. */
export async function moveLeadToStage(leadId: string, targetStageId: string, reason: string) {
  const target = await prisma.stage.findUnique({ where: { id: targetStageId } })
  if (!target) return
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({ data: { leadId, type: 'stage_change', content: reason } })
  await enterStage(leadId, target.id).catch(() => {})
}

/**
 * Envia uma mensagem de saída: grava no histórico e despacha pro canal
 * (WhatsApp via Baileys, ou nada no simulador — só fica registrado).
 */
export async function dispatchOutbound(
  conversationId: string,
  text: string,
  media?: { url: string; type: 'image' | 'video' | 'document' },
  senderType: 'system' | 'human' | 'ai' = 'system',
  senderUserId?: string,
) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } })
  if (!conv) return

  await prisma.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      senderType,
      senderUserId: senderUserId ?? null,
      content: text || (media ? '[mídia]' : ''),
      mediaUrl: media?.url ?? null,
      mediaType: media?.type ?? null,
    },
  })
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } })

  // Despacha pro canal de origem
  try {
    if (conv.channel === 'whatsapp' && conv.accountId && conv.contact?.whatsappId) {
      const wa = await import('./whatsapp')
      const jid = conv.contact.whatsappId
      if (media) await wa.sendMedia(conv.accountId, jid, { url: media.url, type: media.type, caption: text })
      else await wa.sendText(conv.accountId, jid, text)
    } else if (conv.channel === 'facebook' || conv.channel === 'instagram') {
      const meta = await import('./meta')
      const recipient = conv.channel === 'facebook' ? conv.contact?.facebookId : conv.contact?.instagramId
      if (recipient) {
        if (media) await meta.sendMetaMedia(conv.channel, recipient, media.url, media.type === 'document' ? 'file' : media.type)
        else if (text) await meta.sendMetaMessage(conv.channel, recipient, text)
      }
    }
  } catch (e) {
    console.error('[flow dispatch]', e)
  }
}

/**
 * Dispara a "chamada" da etapa quando um lead ENTRA nela.
 * Mensagens com delay 0 saem na hora; as demais ficam agendadas.
 */
export async function enterStage(leadId: string, stageId: string) {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  if (!stage || !stage.botEnabled) return
  const flow = stage.flow as StageFlow | null
  if (!flow) return

  const conv = await prisma.conversation.findFirst({
    where: { leadId }, orderBy: { lastMessageAt: 'desc' },
  })
  if (!conv) return

  // Cancela checagens de inatividade antigas (de outra etapa)
  await prisma.scheduledAction.updateMany({
    where: { leadId, type: 'no_reply', done: false }, data: { done: true },
  })

  // contato (para personalização {nome})
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  const nome = lead?.contact?.name?.split(' ')[0] ?? ''

  let acc = 0
  for (const m of flow.openingMessages ?? []) {
    acc += m.delaySeconds || 0
    const text = (m.text || '').replace(/\{nome\}/gi, nome)
    const media = m.mediaUrl ? { url: m.mediaUrl, type: m.mediaType ?? 'image' } : undefined
    if (acc <= 0) {
      await dispatchOutbound(conv.id, text, media)
    } else {
      await prisma.scheduledAction.create({
        data: {
          leadId, conversationId: conv.id, stageId,
          type: 'send_message',
          payload: { text, mediaUrl: media?.url, mediaType: media?.type } as object,
          runAt: new Date(Date.now() + acc * 1000),
        },
      })
    }
  }

  // ⏱️ Mudança automática por inatividade: agenda checagem após a chamada + X min
  if (flow.noReplyMinutes && flow.noReplyMinutes > 0 && flow.noReplyTargetStageId) {
    await prisma.scheduledAction.create({
      data: {
        leadId, conversationId: conv.id, stageId,
        type: 'no_reply',
        payload: { fromStageId: stageId, targetStageId: flow.noReplyTargetStageId } as object,
        runAt: new Date(Date.now() + (acc + flow.noReplyMinutes * 60) * 1000),
      },
    })
  }
}

/** Processa as ações agendadas vencidas. Chamado pelo poller. */
export async function processDueActions() {
  const due = await prisma.scheduledAction.findMany({
    where: { done: false, runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' }, take: 20,
  })
  for (const a of due) {
    try {
      if (a.type === 'send_message') {
        const p = (a.payload as { text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }) ?? {}
        await dispatchOutbound(a.conversationId, p.text ?? '', p.mediaUrl ? { url: p.mediaUrl, type: p.mediaType ?? 'image' } : undefined)
      } else if (a.type === 'no_reply') {
        await handleNoReply(a)
      }
    } catch (e) {
      console.error('[flow processDue]', e)
    } finally {
      await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
    }
  }
}

/** Move o lead por inatividade — só se ele não respondeu e ainda está na etapa. */
async function handleNoReply(a: { id: string; leadId: string; conversationId: string; createdAt: Date; payload: unknown }) {
  const p = (a.payload as { fromStageId?: string; targetStageId?: string }) ?? {}
  if (!p.fromStageId || !p.targetStageId) return

  const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
  if (!lead || lead.stageId !== p.fromStageId) return // já mudou de etapa → ignora

  // Cliente respondeu depois que a checagem foi agendada? → não move
  const inbound = await prisma.message.count({
    where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } },
  })
  if (inbound > 0) return

  const target = await prisma.stage.findUnique({ where: { id: p.targetStageId } })
  if (!target) return

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({
    data: { leadId: lead.id, type: 'stage_change', content: `Movido automaticamente para "${target.name}" por inatividade do cliente.` },
  })
  // dispara a chamada da nova etapa
  await enterStage(lead.id, target.id).catch(() => {})
}

/** Inicia o poller único (sobrevive ao HMR via global). */
export function startScheduler() {
  const g = globalThis as unknown as { __crmScheduler?: NodeJS.Timeout }
  if (g.__crmScheduler) return
  g.__crmScheduler = setInterval(() => { processDueActions().catch(() => {}) }, 15000)
}
