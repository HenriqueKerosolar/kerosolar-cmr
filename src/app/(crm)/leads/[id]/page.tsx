import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { LeadCardClient } from './lead-card-client'

export const dynamic = 'force-dynamic'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession()
  const { id } = await params

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      contact: true,
      stage: true,
      pipeline: { include: { stages: { orderBy: { sortOrder: 'asc' } } } },
      tasks: { orderBy: { createdAt: 'desc' } },
      notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
      conversations: { include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { lastMessageAt: 'desc' }, take: 1 },
    },
  })
  if (!lead) notFound()

  // Próximas ações automáticas agendadas (follow-ups, retomada 9h, validade etc.)
  const scheduledActions = await prisma.scheduledAction.findMany({
    where: { leadId: id, done: false },
    orderBy: { runAt: 'asc' }, take: 5,
    select: { id: true, type: true, runAt: true },
  })

  const messages = lead.conversations[0]?.messages ?? []
  return <LeadCardClient lead={JSON.parse(JSON.stringify({ ...lead, messages, scheduledActions }))} />
}
