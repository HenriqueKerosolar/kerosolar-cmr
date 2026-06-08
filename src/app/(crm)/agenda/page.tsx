import { prisma } from '@/lib/prisma'
import { getSessionSafe } from '@/lib/dal'
import { redirect } from 'next/navigation'
import { AgendaClient } from './agenda-client'

export default async function AgendaPage() {
  const session = await getSessionSafe()
  if (!session) redirect('/login')

  const now = new Date()
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const appointments = await prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }, // últimos 7 dias + próximos 30
      status: { not: 'cancelled' },
    },
    include: {
      lead: {
        include: {
          contact: true,
          stage: true,
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  })

  return <AgendaClient appointments={appointments.map(a => ({
    id: a.id,
    title: a.title,
    scheduledAt: a.scheduledAt.toISOString(),
    channel: a.channel,
    status: a.status,
    notes: a.notes,
    remindedAt: a.remindedAt?.toISOString() ?? null,
    leadId: a.leadId,
    leadTitle: a.lead.title,
    contactName: a.lead.contact?.name ?? null,
    contactPhone: a.lead.contact?.phone ?? null,
    stageName: a.lead.stage.name,
    stageColor: a.lead.stage.color,
  }))} />
}
