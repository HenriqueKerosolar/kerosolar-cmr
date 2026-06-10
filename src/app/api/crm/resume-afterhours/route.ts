import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { respeitaHorarioGlobal } from '@/lib/crm/schedule-window'

/**
 * 🌅 Retomada manual (uma vez): arma a retomada do horário comercial para todos os leads que
 * receberam o "agora ou depois?" fora do horário e NÃO responderam. A IA volta a falar com
 * eles no próximo horário comercial (9h) — cumprindo a promessa da mensagem.
 *
 * Só conta como "parado" se a ÚLTIMA mensagem da conversa foi nossa (cliente não respondeu).
 * É idempotente: se já houver uma retomada pendente para o lead, não duplica.
 */
export async function POST() {
  const session = await getSessionSafe()
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 })

  const leads = await prisma.lead.findMany({
    where: { afterHoursAsked: true, humanOnly: false, aiEnabled: true, status: 'open' },
    select: { id: true, stageId: true },
  })

  const runAt = respeitaHorarioGlobal(new Date())   // agora (se for horário comercial) ou às 9h
  let armados = 0
  const detalhes: { leadId: string }[] = []

  for (const lead of leads) {
    const conv = await prisma.conversation.findFirst({
      where: { leadId: lead.id }, orderBy: { lastMessageAt: 'desc' }, select: { id: true },
    })
    if (!conv) continue

    // Cliente respondeu? (última mensagem da conversa não é nossa) → pula
    const last = await prisma.message.findFirst({
      where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, select: { direction: true },
    })
    if (!last || last.direction !== 'outbound') continue

    // Já tem retomada pendente? → não duplica
    const pendente = await prisma.scheduledAction.count({
      where: { leadId: lead.id, type: 'after_hours_resume', done: false },
    })
    if (pendente > 0) continue

    await prisma.scheduledAction.create({
      data: { leadId: lead.id, conversationId: conv.id, stageId: lead.stageId, type: 'after_hours_resume', payload: {} as object, runAt },
    }).catch(() => {})
    armados++
    detalhes.push({ leadId: lead.id })
  }

  return NextResponse.json({ ok: true, candidatos: leads.length, armados, runAt: runAt.toISOString(), detalhes })
}
