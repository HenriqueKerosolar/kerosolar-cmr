'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'
import { dispatchOutbound, enterStage } from '@/lib/crm/flow'

/** Atendente envia uma mensagem manual (texto e/ou mídia por URL). */
export async function sendManualMessage(leadId: string, text: string, media?: { url: string; type: 'image' | 'video' | 'document' }) {
  const session = await verifySession()
  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' } })
  if (!conv) throw new Error('Esse lead ainda não tem conversa.')
  await dispatchOutbound(conv.id, text, media, 'human', session.userId)
  await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
  revalidatePath(`/leads/${leadId}`)
}

/** Liga/desliga a IA para este lead (atendente assume ou devolve pro bot). */
export async function toggleLeadAi(leadId: string, enabled: boolean) {
  await verifySession()
  await prisma.lead.update({ where: { id: leadId }, data: { aiEnabled: enabled } })
  const conv = await prisma.conversation.findFirst({ where: { leadId } })
  if (conv) await prisma.conversation.update({ where: { id: conv.id }, data: { aiEnabled: enabled } })
  await prisma.note.create({ data: { leadId, type: 'system', content: enabled ? 'IA reativada.' : 'Atendente assumiu a conversa.' } })
  revalidatePath(`/leads/${leadId}`)
}

/** Move o lead para outra etapa (dispara a chamada da nova etapa). */
export async function moveLeadStage(leadId: string, stageId: string) {
  await verifySession()
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead || lead.stageId === stageId) return
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId,
      status: stage?.isWon ? 'won' : stage?.isLost ? 'lost' : 'open',
      closedAt: stage?.isWon || stage?.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({ data: { leadId, type: 'stage_change', content: `Movido para "${stage?.name}".` } })
  await enterStage(leadId, stageId).catch(() => {})
  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
}

export async function updateLeadValue(leadId: string, value: number) {
  await verifySession()
  await prisma.lead.update({ where: { id: leadId }, data: { value } })
  revalidatePath(`/leads/${leadId}`)
}

export async function addNote(leadId: string, content: string) {
  const session = await verifySession()
  if (!content.trim()) return
  await prisma.note.create({ data: { leadId, type: 'note', content: content.trim(), authorId: session.userId } })
  revalidatePath(`/leads/${leadId}`)
}

export async function addTask(leadId: string, title: string, dueAt?: string) {
  const session = await verifySession()
  if (!title.trim()) return
  await prisma.task.create({
    data: { leadId, title: title.trim(), responsibleId: session.userId, dueAt: dueAt ? new Date(dueAt) : null },
  })
  revalidatePath(`/leads/${leadId}`)
}

export async function completeTask(taskId: string) {
  await verifySession()
  const t = await prisma.task.findUnique({ where: { id: taskId } })
  await prisma.task.update({ where: { id: taskId }, data: { status: 'completed', completedAt: new Date() } })
  if (t) revalidatePath(`/leads/${t.leadId}`)
}
