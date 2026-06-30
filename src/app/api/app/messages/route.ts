import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Mensagens de uma conversa pro app de atendimento. Marca os recebidos como lidos. */
export async function GET(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const convId = req.nextUrl.searchParams.get('conv')
  if (!convId) return NextResponse.json({ error: 'sem conversa' }, { status: 400 })

  const conv = await prisma.conversation.findUnique({
    where: { id: convId },
    include: { contact: true, lead: { include: { stage: true } } },
  })
  if (!conv) return NextResponse.json({ error: 'conversa não encontrada' }, { status: 404 })

  // Etapas do funil do lead (pra mostrar e mover)
  const stages = conv.lead?.pipelineId
    ? await prisma.stage.findMany({ where: { pipelineId: conv.lead.pipelineId }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, color: true } })
    : []

  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, direction: true, senderType: true, content: true, mediaUrl: true, mediaType: true, createdAt: true },
  })

  // Marca recebidos como lidos (some o "não lido" no app/inbox)
  await prisma.message.updateMany({
    where: { conversationId: convId, direction: 'inbound', isRead: false },
    data: { isRead: true },
  }).catch(() => {})

  return NextResponse.json({
    name: conv.contact?.name || conv.contact?.phone || 'Cliente',
    leadId: conv.leadId,
    channel: conv.channel,
    stageId: conv.lead?.stageId ?? null,
    stageName: conv.lead?.stage?.name ?? null,
    stageColor: conv.lead?.stage?.color ?? null,
    stages,
    messages,
  })
}
