import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { nextAllowedSlot, respeitaHorarioGlobal, tempoDigitacaoMs, janelaDoFunil } from '@/lib/crm/schedule-window'

/**
 * Disparo manual de mensagem para todos os leads de uma etapa.
 * Respeita a janela de horário e o espaçamento humano (não dispara tudo junto,
 * tempos diferentes por mensagem). Pula leads em bloqueio total (humanOnly).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { stageId, text, mediaUrl, mediaType } = await req.json()
  if (!stageId || (!text?.trim() && !mediaUrl)) {
    return NextResponse.json({ error: 'Escolha a etapa e escreva a mensagem.' }, { status: 400 })
  }

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { pipeline: { select: { sendStartHour: true, sendEndHour: true } } } })
  const janela = janelaDoFunil(stage?.pipeline?.sendStartHour, stage?.pipeline?.sendEndHour)

  const leads = await prisma.lead.findMany({
    where: { stageId, status: 'open', humanOnly: false },
    include: { contact: true, conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1 } },
  })

  let cursor = Date.now()
  let agendados = 0
  for (const lead of leads) {
    const conv = lead.conversations[0]
    if (!conv) continue // sem conversa → não dá pra enviar
    const nome = lead.contact?.name?.split(' ')[0] ?? ''
    const msg = (text || '').replace(/\{nome\}/gi, nome)

    cursor += tempoDigitacaoMs(msg) // espaçamento humano, diferente por mensagem
    const sendAt = nextAllowedSlot(respeitaHorarioGlobal(new Date(cursor)), janela)
    cursor = sendAt.getTime()

    await prisma.scheduledAction.create({
      data: {
        leadId: lead.id, conversationId: conv.id, stageId,
        type: 'send_message',
        payload: { text: msg, mediaUrl: mediaUrl || undefined, mediaType: mediaType || undefined } as object,
        runAt: sendAt,
      },
    })
    agendados++
  }

  return NextResponse.json({ ok: true, total: leads.length, agendados })
}
