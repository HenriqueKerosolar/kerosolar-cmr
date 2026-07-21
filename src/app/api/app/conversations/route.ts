import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lista de conversas pro app de atendimento (mobile). */
export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const convs = await prisma.conversation.findMany({
    // Encerradas somem (voltam quando o cliente escrever). Só aparecem conversas com
    // INTERAÇÃO REAL: o lead precisa ter enviado ao menos 1 mensagem (não só recebido do sistema).
    where: { resolvedAt: null, messages: { some: { direction: 'inbound' } } },
    orderBy: { lastMessageAt: 'asc' }, // mais antigos primeiro (mesma regra do Inbox do computador)
    take: 200,
    include: {
      contact: true,
      lead: { include: { stage: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  const list = convs.map((c) => {
    const last = c.messages[0]
    return {
      id: c.id,
      leadId: c.leadId,
      channel: c.channel,
      name: c.contact?.name || c.contact?.phone || 'Cliente',
      phone: c.contact?.phone || null,
      lastText: last ? (last.direction === 'outbound' ? (last.senderType === 'ai' ? '🤖 ' : '✓ ') : '') + (last.content || '') : '',
      lastAt: c.lastMessageAt,
      unread: !!last && last.direction === 'inbound' && !last.isRead,
      stage: c.lead?.stage ? { name: c.lead.stage.name, color: c.lead.stage.color } : null,
    }
  })

  return NextResponse.json({ conversations: list })
}
