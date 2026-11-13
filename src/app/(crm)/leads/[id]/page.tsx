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

  // 👀 Operador abriu a conversa → as mensagens do cliente contam como VISTAS (igual ao app do
  //    celular). Ela sai do "Precisam de mim" e volta quando o cliente mandar mensagem nova.
  const convIds = lead.conversations.map((c) => c.id)
  if (convIds.length) {
    await prisma.message.updateMany({ where: { conversationId: { in: convIds }, direction: 'inbound', isRead: false }, data: { isRead: true } }).catch(() => {})
  }

  // Próximas ações automáticas agendadas (follow-ups, retomada 9h, validade etc.)
  const agendadas = await prisma.scheduledAction.findMany({
    where: { leadId: id, done: false },
    orderBy: { runAt: 'asc' }, take: 5,
    select: { id: true, type: true, runAt: true },
  })
  // Mostra o horário em que a mensagem VAI SAIR de fato: o agendador adia o que cair fora da
  // janela (regra global 8h–19h + horário comercial do funil). Antes, o cartão mostrava "22:11".
  const { nextAllowedSlot, respeitaHorarioGlobal, janelaDoFunil } = await import('@/lib/crm/schedule-window')
  const janela = janelaDoFunil(lead.pipeline?.sendStartHour, lead.pipeline?.sendEndHour)
  const NUDGE = new Set(['flow_continue', 'flow_noreply', 'budget_followup', 'budget_validity', 'reengage', 'chegada_followup', 'after_hours_resume', 'no_reply', 'ac_followup'])
  const scheduledActions = agendadas
    .map((a) => ({
      ...a,
      runAt: NUDGE.has(a.type) ? nextAllowedSlot(respeitaHorarioGlobal(a.runAt), janela)
        : a.type === 'adiada_horario' ? respeitaHorarioGlobal(a.runAt)
        : a.runAt,
    }))
    .sort((x, y) => x.runAt.getTime() - y.runAt.getTime())

  const messages = lead.conversations[0]?.messages ?? []
  const conversationId = lead.conversations[0]?.id ?? null
  const conversationResolved = !!lead.conversations[0]?.resolvedAt
  return <LeadCardClient lead={JSON.parse(JSON.stringify({ ...lead, messages, scheduledActions, conversationId, conversationResolved }))} />
}
