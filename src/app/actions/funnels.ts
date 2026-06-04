'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'

const DEFAULT_NEW_STAGES = [
  { name: 'Novo',        color: '#3b82f6', sortOrder: 0 },
  { name: 'Em andamento', color: '#eab308', sortOrder: 1 },
  { name: 'Ganho',       color: '#22c55e', sortOrder: 2, isWon: true },
  { name: 'Perdido',     color: '#ef4444', sortOrder: 3, isLost: true },
]

export async function createPipeline(data: { name: string; icon?: string; description?: string }) {
  await verifySession()
  const count = await prisma.pipeline.count()
  const pipeline = await prisma.pipeline.create({
    data: {
      name: data.name.trim() || 'Novo funil',
      icon: data.icon || '📁',
      description: data.description ?? null,
      isDefault: count === 0,
      sortOrder: count,
      stages: { create: DEFAULT_NEW_STAGES },
    },
    include: { stages: true },
  })
  revalidatePath('/funis')
  revalidatePath('/leads')
  return pipeline.id
}

export async function updatePipeline(id: string, data: {
  name?: string; icon?: string; description?: string
  botEnabled?: boolean; botName?: string; botPrompt?: string; aiModel?: string
}) {
  await verifySession()
  await prisma.pipeline.update({ where: { id }, data })
  revalidatePath('/funis')
  revalidatePath('/leads')
}

export async function deletePipeline(id: string) {
  await verifySession()
  const total = await prisma.pipeline.count()
  if (total <= 1) throw new Error('Você precisa ter pelo menos um funil.')
  const leads = await prisma.lead.count({ where: { pipelineId: id } })
  if (leads > 0) throw new Error(`Esse funil tem ${leads} lead(s). Mova ou exclua os leads antes.`)

  const wasDefault = (await prisma.pipeline.findUnique({ where: { id } }))?.isDefault
  await prisma.pipeline.delete({ where: { id } })
  if (wasDefault) {
    const first = await prisma.pipeline.findFirst({ orderBy: { sortOrder: 'asc' } })
    if (first) await prisma.pipeline.update({ where: { id: first.id }, data: { isDefault: true } })
  }
  revalidatePath('/funis')
  revalidatePath('/leads')
}

// ─── Etapas ──────────────────────────────────────────────────────────────────

export async function addStage(pipelineId: string, name: string) {
  await verifySession()
  const max = await prisma.stage.aggregate({ where: { pipelineId }, _max: { sortOrder: true } })
  // insere antes das etapas de fechamento (won/lost) idealmente — aqui só adiciona ao fim
  await prisma.stage.create({
    data: { pipelineId, name: name.trim() || 'Nova etapa', color: '#64748b', sortOrder: (max._max.sortOrder ?? 0) + 1 },
  })
  revalidatePath('/funis')
  revalidatePath('/leads')
}

export type StageFlow = {
  openingMessages: { text: string; delaySeconds: number; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }[]
  handoffToAi: boolean   // depois da "chamada", entrega a conversa pra IA da etapa
  // Mudança de etapa por PALAVRA-CHAVE (e variações) detectada na mensagem do cliente
  keywordRules?: { keywords: string; targetStageId: string }[]
  // Mudança automática por inatividade do cliente
  noReplyMinutes?: number          // 0/ausente = desligado
  noReplyTargetStageId?: string    // etapa de destino se o cliente não responder
}

export async function updateStage(id: string, data: {
  name?: string; color?: string; isWon?: boolean; isLost?: boolean
  botEnabled?: boolean; botPrompt?: string; flow?: StageFlow
}) {
  await verifySession()
  await prisma.stage.update({
    where: { id },
    data: { ...data, flow: data.flow ? (data.flow as unknown as object) : undefined },
  })
  revalidatePath('/funis')
  revalidatePath('/leads')
}

export async function deleteStage(id: string) {
  await verifySession()
  const stage = await prisma.stage.findUnique({ where: { id }, include: { _count: { select: { leads: true } } } })
  if (!stage) return
  const stageCount = await prisma.stage.count({ where: { pipelineId: stage.pipelineId } })
  if (stageCount <= 1) throw new Error('O funil precisa ter pelo menos uma etapa.')
  if (stage._count.leads > 0) {
    // move os leads para a primeira etapa restante
    const fallback = await prisma.stage.findFirst({
      where: { pipelineId: stage.pipelineId, id: { not: id } },
      orderBy: { sortOrder: 'asc' },
    })
    if (fallback) await prisma.lead.updateMany({ where: { stageId: id }, data: { stageId: fallback.id } })
  }
  await prisma.stage.delete({ where: { id } })
  revalidatePath('/funis')
  revalidatePath('/leads')
}

export async function reorderStages(pipelineId: string, orderedIds: string[]) {
  await verifySession()
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.stage.update({ where: { id }, data: { sortOrder: i } })),
  )
  revalidatePath('/funis')
  revalidatePath('/leads')
}

// ─── Vínculo WhatsApp ↔ Funil ─────────────────────────────────────────────────

export async function setPipelineChannels(pipelineId: string, accountIds: string[]) {
  await verifySession()
  await prisma.$transaction([
    prisma.whatsappAccountPipeline.deleteMany({ where: { pipelineId } }),
    ...accountIds.map((accountId) =>
      prisma.whatsappAccountPipeline.create({ data: { pipelineId, accountId } }),
    ),
  ])
  revalidatePath('/funis')
}
