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

  const body = await req.json()
  const { stageId, text, mediaUrl, mediaType } = body
  // Filtros/regras da lista de transmissão (todos opcionais)
  const minDays  = Number.isFinite(body.minDays)  ? Math.max(0, Math.floor(body.minDays))  : null  // só leads há +X dias na plataforma
  const maxDays  = Number.isFinite(body.maxDays)  ? Math.max(0, Math.floor(body.maxDays))  : null  // até X dias
  const order: 'oldest' | 'newest' = body.order === 'newest' ? 'newest' : 'oldest'                  // ordem por tempo na plataforma
  const limit    = Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : null     // nº máximo de leads
  const intervalMin = Number.isFinite(body.intervalMin) && body.intervalMin > 0 ? Math.floor(body.intervalMin) : 0 // intervalo mínimo entre envios
  const vary = body.vary === true                                                                    // variar a mensagem por lead (IA)

  if (!stageId || (!text?.trim() && !mediaUrl)) {
    return NextResponse.json({ error: 'Escolha a etapa e escreva a mensagem.' }, { status: 400 })
  }

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { pipeline: { select: { sendStartHour: true, sendEndHour: true } } } })
  const janela = janelaDoFunil(stage?.pipeline?.sendStartHour, stage?.pipeline?.sendEndHour)

  // Filtro por TEMPO NA PLATAFORMA (createdAt): há +minDays e até maxDays dias.
  const createdAt: { lte?: Date; gte?: Date } = {}
  if (minDays != null) createdAt.lte = new Date(Date.now() - minDays * 86400000)  // criado há PELO MENOS minDays
  if (maxDays != null) createdAt.gte = new Date(Date.now() - maxDays * 86400000)  // criado há NO MÁXIMO maxDays

  const leads = await prisma.lead.findMany({
    where: { stageId, status: 'open', humanOnly: false, ...(minDays != null || maxDays != null ? { createdAt } : {}) },
    include: { contact: true, conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1 } },
    orderBy: { createdAt: order === 'newest' ? 'desc' : 'asc' },  // mais novos ou mais antigos primeiro
    ...(limit ? { take: limit } : {}),
  })

  let cursor = Date.now()
  let agendados = 0
  for (const lead of leads) {
    const conv = lead.conversations[0]
    if (!conv) continue // sem conversa → não dá pra enviar
    const nome = lead.contact?.name?.split(' ')[0] ?? ''
    const msg = (text || '').replace(/\{nome\}/gi, nome)

    // espaçamento: simula digitação + intervalo mínimo configurado entre envios
    cursor += Math.max(tempoDigitacaoMs(msg), intervalMin * 60000)
    const sendAt = nextAllowedSlot(respeitaHorarioGlobal(new Date(cursor)), janela)
    cursor = sendAt.getTime()

    await prisma.scheduledAction.create({
      data: {
        leadId: lead.id, conversationId: conv.id, stageId,
        type: 'send_message',
        // vary=true → a variação é gerada pela IA na HORA do envio (no poller), por lead
        payload: { text: msg, mediaUrl: mediaUrl || undefined, mediaType: mediaType || undefined, vary: vary || undefined } as object,
        runAt: sendAt,
      },
    })
    agendados++
  }

  return NextResponse.json({ ok: true, total: leads.length, agendados })
}
