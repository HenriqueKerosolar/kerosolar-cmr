import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params

  const conv = await prisma.conversation.findFirst({ where: { leadId: id }, orderBy: { lastMessageAt: 'desc' } })
  const messages = conv
    ? await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } })
    : []
  const lead = await prisma.lead.findUnique({ where: { id }, select: { aiEnabled: true, stageId: true } })
  return NextResponse.json({ messages, aiEnabled: lead?.aiEnabled, stageId: lead?.stageId })
}
