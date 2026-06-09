import 'server-only'
import { prisma } from '@/lib/prisma'

type FlowMsg = { text: string; delaySeconds: number; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }
type StageFlow = {
  openingMessages: FlowMsg[]
  handoffToAi: boolean
  keywordRules?: { keywords: string; targetStageId: string }[]
  noReplyMinutes?: number
  noReplyTargetStageId?: string
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Verifica se a mensagem do cliente contém alguma palavra-chave (ou variação)
 * configurada na etapa atual. Retorna a etapa de destino, se houver.
 */
export async function keywordTargetFor(stageId: string, text: string): Promise<string | null> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const flow = stage?.flow as StageFlow | null
  if (!flow?.keywordRules?.length) return null
  const t = normalize(text)
  for (const rule of flow.keywordRules) {
    if (!rule.targetStageId) continue
    const words = rule.keywords.split(',').map((w) => normalize(w.trim())).filter(Boolean)
    if (words.some((w) => w.length >= 2 && t.includes(w))) return rule.targetStageId
  }
  return null
}

/** Move o lead para uma etapa (uso por palavra-chave / manual), disparando a chamada. */
export async function moveLeadToStage(leadId: string, targetStageId: string, reason: string) {
  const target = await prisma.stage.findUnique({ where: { id: targetStageId } })
  if (!target) return
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({ data: { leadId, type: 'stage_change', content: reason } })
  await enterStage(leadId, target.id).catch(() => {})
}

/**
 * Envia uma mensagem de saída: grava no histórico e despacha pro canal
 * (WhatsApp via Baileys, ou nada no simulador — só fica registrado).
 */
export async function dispatchOutbound(
  conversationId: string,
  text: string,
  media?: { url: string; type: 'image' | 'video' | 'document' },
  senderType: 'system' | 'human' | 'ai' = 'system',
  senderUserId?: string,
) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } })
  if (!conv) return

  // 🔒 Anti-repetição (regra universal: nunca repetir mensagem). Mensagens automáticas
  // (ai/system) NÃO são reenviadas se forem idênticas à última que NÓS mandamos nesta
  // conversa — evita follow-up/saudação duplicados e loop da IA. (Humano pode repetir.)
  if (text && !media && (senderType === 'ai' || senderType === 'system')) {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const lastOut = await prisma.message.findFirst({
      where: { conversationId, direction: 'outbound', senderType: { in: ['ai', 'system'] } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    if (lastOut && norm(lastOut.content) === norm(text)) {
      console.warn('[flow dispatch] mensagem repetida bloqueada:', text.slice(0, 60))
      return
    }
  }

  await prisma.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      senderType,
      senderUserId: senderUserId ?? null,
      content: text || (media ? '[mídia]' : ''),
      mediaUrl: media?.url ?? null,
      mediaType: media?.type ?? null,
    },
  })
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } })

  // Despacha pro canal de origem
  try {
    if (conv.channel === 'whatsapp' && conv.accountId && conv.contact?.whatsappId) {
      const wa = await import('./whatsapp')
      const jid = conv.contact.whatsappId
      if (media) await wa.sendMedia(conv.accountId, jid, { url: media.url, type: media.type, caption: text })
      else await wa.sendText(conv.accountId, jid, text)
    } else if (conv.channel === 'facebook' || conv.channel === 'instagram') {
      const meta = await import('./meta')
      const recipient = conv.channel === 'facebook' ? conv.contact?.facebookId : conv.contact?.instagramId
      if (recipient) {
        if (media) await meta.sendMetaMedia(conv.channel, recipient, media.url, media.type === 'document' ? 'file' : media.type)
        else if (text) await meta.sendMetaMessage(conv.channel, recipient, text)
      }
    }
  } catch (e) {
    console.error('[flow dispatch]', e)
    // 🔁 Envio falhou (ex.: WhatsApp reiniciando/caído). NÃO perde a mensagem: re-enfileira
    // pra reentregar quando a conexão voltar — sem criar nova mensagem no chat (não duplica).
    if (conv.channel === 'whatsapp' && conv.leadId) {
      await prisma.scheduledAction.create({
        data: {
          leadId: conv.leadId, conversationId, stageId: null, type: 'redeliver',
          payload: { text, mediaUrl: media?.url ?? null, mediaType: media?.type ?? null, attempts: 0 } as object,
          runAt: new Date(Date.now() + 30000),
        },
      }).catch(() => {})
    }
  }
}

/**
 * Dispara a "chamada" da etapa quando um lead ENTRA nela.
 * Mensagens com delay 0 saem na hora; as demais ficam agendadas.
 */
export async function enterStage(leadId: string, stageId: string) {
  // Cliente recusou bot → nenhuma automação dispara
  const leadCheck = await prisma.lead.findUnique({ where: { id: leadId }, select: { humanOnly: true } })
  if (leadCheck?.humanOnly) return

  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  if (!stage || !stage.botEnabled) return
  const flow = stage.flow as (StageFlow & { blocks?: unknown[] }) | null
  if (!flow) return

  const conv = await prisma.conversation.findFirst({
    where: { leadId }, orderBy: { lastMessageAt: 'desc' },
  })
  if (!conv) return

  const isSimulator = conv.channel === 'simulator'

  // 📅 Etapas de ORÇAMENTO: agenda o lembrete de validade (1 dia depois) — "orçamento válido
  //    por 3 dias". Vale pras duas etapas ("Recebeu orçamento automático" e "...manual").
  if (!isSimulator && /or[çc]amento/i.test(stage.name)) {
    await prisma.scheduledAction.updateMany({ where: { leadId, type: 'budget_validity', done: false }, data: { done: true } })
    await prisma.scheduledAction.create({
      data: { leadId, conversationId: conv.id, stageId, type: 'budget_validity', payload: {} as object, runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    }).catch(() => {})
  }

  // Se a etapa usa o construtor de BLOCOS, executa o fluxo de blocos e encerra aqui.
  if (flow.blocks && flow.blocks.length) {
    const { startBlockFlow } = await import('./flow-blocks')
    await startBlockFlow(leadId, conv.id, stageId, isSimulator)
    return
  }

  // Cancela checagens de inatividade antigas (de outra etapa)
  await prisma.scheduledAction.updateMany({
    where: { leadId, type: 'no_reply', done: false }, data: { done: true },
  })

  // contato (para personalização {nome})
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  const nome = lead?.contact?.name?.split(' ')[0] ?? ''

  const { nextAllowedSlot, respeitaHorarioGlobal, tempoDigitacaoMs, janelaDoFunil } = await import('./schedule-window')
  const pipe = await prisma.pipeline.findUnique({ where: { id: stage.pipelineId }, select: { sendStartHour: true, sendEndHour: true } })
  const janela = janelaDoFunil(pipe?.sendStartHour, pipe?.sendEndHour)
  let cursor = Date.now()
  for (const m of flow.openingMessages ?? []) {
    const text = (m.text || '').replace(/\{nome\}/gi, nome)
    const media = m.mediaUrl ? { url: m.mediaUrl, type: m.mediaType ?? 'image' } : undefined
    // espaçamento humano (delay configurado + tempo de digitação) dentro da janela permitida
    cursor += (m.delaySeconds || 0) * 1000 + tempoDigitacaoMs(text)
    const sendAt = nextAllowedSlot(respeitaHorarioGlobal(new Date(cursor)), janela)
    cursor = sendAt.getTime()
    if (isSimulator || sendAt.getTime() <= Date.now() + 1500) {
      await dispatchOutbound(conv.id, text, media)
    } else {
      await prisma.scheduledAction.create({
        data: {
          leadId, conversationId: conv.id, stageId,
          type: 'send_message',
          payload: { text, mediaUrl: media?.url, mediaType: media?.type } as object,
          runAt: sendAt,
        },
      })
    }
  }

  // ⏱️ Mudança automática por inatividade: agenda checagem após a chamada + X min (não no simulador)
  if (!isSimulator && flow.noReplyMinutes && flow.noReplyMinutes > 0 && flow.noReplyTargetStageId) {
    await prisma.scheduledAction.create({
      data: {
        leadId, conversationId: conv.id, stageId,
        type: 'no_reply',
        payload: { fromStageId: stageId, targetStageId: flow.noReplyTargetStageId } as object,
        runAt: new Date(cursor + flow.noReplyMinutes * 60 * 1000),
      },
    })
  }
}

/** Processa as ações agendadas vencidas. Chamado pelo poller. */
export async function processDueActions() {
  const due = await prisma.scheduledAction.findMany({
    where: { done: false, runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' }, take: 20,
  })
  const { nextAllowedSlot, respeitaHorarioGlobal, tempoDigitacaoMs, janelaDoFunil } = await import('./schedule-window')
  let cursor = Date.now()   // garante espaçamento entre envios desta rodada

  for (const a of due) {
    try {
      // ⏰ Mensagens automáticas ENTRE ETAPAS só saem em HORÁRIO COMERCIAL (dia útil + janela
      //    do funil). Se a ação vencer fora do horário, reagenda pro próximo horário válido
      //    (ex.: 9h do próximo dia útil) em vez de mandar de madrugada/fim de semana.
      if (a.type === 'flow_continue' || a.type === 'flow_noreply' || a.type === 'budget_followup' || a.type === 'budget_validity') {
        const ldw = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { pipeline: { select: { sendStartHour: true, sendEndHour: true } } } })
        const janela = janelaDoFunil(ldw?.pipeline?.sendStartHour, ldw?.pipeline?.sendEndHour)
        const slot = nextAllowedSlot(respeitaHorarioGlobal(new Date()), janela)
        if (slot.getTime() > Date.now() + 2000) {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: slot } })
          continue
        }
      }
      if (a.type === 'no_reply') {
        await handleNoReply(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'ac_followup') {
        await handleAcFollowup(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'flow_continue') {
        const pl = (a.payload as { stageId?: string; index?: number }) ?? {}
        if (pl.stageId && typeof pl.index === 'number') {
          const { resumeAfterWait } = await import('./flow-blocks')
          await resumeAfterWait(a.conversationId, a.leadId, pl.stageId, pl.index)
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'flow_noreply') {
        const { handleFlowNoReply } = await import('./flow-blocks')
        await handleFlowNoReply(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'budget_followup') {
        await handleBudgetFollowup(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'appointment_reminder') {
        await handleAppointmentReminder(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      // 🔁 Reentrega de mensagem que falhou (WhatsApp estava caído). NÃO cria nova mensagem
      // no chat — só reenvia o texto/mídia. Tenta a cada 1 min por ~20 min; depois desiste.
      if (a.type === 'redeliver') {
        const p = (a.payload as { text?: string; mediaUrl?: string | null; mediaType?: 'image' | 'video' | 'document' | null; attempts?: number }) ?? {}
        const attempts = p.attempts ?? 0
        const conv = await prisma.conversation.findUnique({ where: { id: a.conversationId }, include: { contact: true } })
        let ok = false
        try {
          if (conv?.channel === 'whatsapp' && conv.accountId && conv.contact?.whatsappId) {
            const wa = await import('./whatsapp')
            const jid = conv.contact.whatsappId
            if (p.mediaUrl) await wa.sendMedia(conv.accountId, jid, { url: p.mediaUrl, type: p.mediaType ?? 'image', caption: p.text })
            else if (p.text) await wa.sendText(conv.accountId, jid, p.text)
            ok = true
          }
        } catch { ok = false }
        if (ok || attempts >= 20) {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        } else {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: new Date(Date.now() + 60000), payload: { ...p, attempts: attempts + 1 } as object } }).catch(() => {})
        }
        continue
      }
      if (a.type === 'budget_validity') {
        const ldv = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { humanOnly: true, status: true } })
        if (ldv && !ldv.humanOnly && ldv.status === 'open') {
          const cfg = await prisma.systemConfig.findUnique({ where: { key: 'budget_validity_message' } })
          const spHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
          const saud = spHour < 12 ? 'Bom dia' : spHour < 18 ? 'Boa tarde' : 'Boa noite'
          const msg = (cfg?.value || DEFAULT_BUDGET_VALIDITY).replace(/\{SAUDACAO\}/g, saud)
          await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type !== 'send_message') {
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }

      const p = (a.payload as { text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }) ?? {}
      // Lead pediu bloqueio total? cancela
      const ld = await prisma.lead.findUnique({
        where: { id: a.leadId },
        select: { humanOnly: true, pipeline: { select: { sendStartHour: true, sendEndHour: true } } },
      })
      if (ld?.humanOnly) { await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }); continue }

      // Próximo horário válido (janela do funil + global), espaçado da mensagem anterior
      const janela = janelaDoFunil(ld?.pipeline?.sendStartHour, ld?.pipeline?.sendEndHour)
      const slot = nextAllowedSlot(respeitaHorarioGlobal(new Date(Math.max(Date.now(), cursor))), janela)
      if (slot.getTime() > Date.now() + 2000) {
        // fora da janela ou precisa espaçar → reagenda (NÃO marca done)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: slot } })
        cursor = slot.getTime() + tempoDigitacaoMs(p.text ?? '')
        continue
      }
      // dentro da janela e na vez → envia
      await dispatchOutbound(a.conversationId, p.text ?? '', p.mediaUrl ? { url: p.mediaUrl, type: p.mediaType ?? 'image' } : undefined)
      cursor = Date.now() + tempoDigitacaoMs(p.text ?? '')
      await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
    } catch (e) {
      console.error('[flow processDue]', e)
      await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
    }
  }
}

const DEFAULT_BUDGET_FOLLOWUP =
  '{nome}, ficou com alguma dúvida sobre o orçamento? 😊 Se quiser um orçamento mais personalizado e preciso, ' +
  'posso agendar uma conversa com nosso Consultor especialista — em geral o valor fica ainda melhor! ' +
  'Quer que eu agende, ou prefere que eu te transfira agora para o Consultor?'

// Lembrete de validade do orçamento — enviado 1 dia depois (configurável em system_configs: budget_validity_message)
const DEFAULT_BUDGET_VALIDITY =
  '{SAUDACAO}! Passando só pra lembrar 😊 Os orçamentos que enviamos ficam *ativos na nossa plataforma por 3 dias* ' +
  'a partir da data em que você recebeu. Depois disso eles saem do sistema e é preciso fazer uma *nova cotação* — ' +
  'e nesse novo pedido o valor pode mudar (por exemplo, se o modelo/marca não estiver mais disponível para cotação, ' +
  'ou por algum reajuste de preço). Se quiser seguir com a sua, é só me avisar que eu te ajudo! 🌞'

/**
 * Follow-up do orçamento (~90s após o orçamento automático):
 * pergunta se ficou dúvida + oferece o consultor especialista.
 * O lead PERMANECE em "Recebeu orçamento automático" (não é movido) — daqui
 * ele segue para a régua de repescagem (15/30/60 dias) depois.
 * Cancelado automaticamente se o cliente responder (cancel-on-inbound no engine).
 */
async function handleBudgetFollowup(a: { leadId: string; conversationId: string; createdAt: Date; payload: unknown }) {
  const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, include: { contact: true } })
  if (!lead || lead.humanOnly || !lead.aiEnabled) return
  const inbound = await prisma.message.count({ where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } } })
  if (inbound > 0) return // cliente respondeu → não interrompe
  const step = (a.payload as { step?: number })?.step ?? 1
  if (step !== 1) return // passo 2 antigo (mover etapa) foi descontinuado — não faz nada

  const cfg = await prisma.systemConfig.findUnique({ where: { key: 'budget_followup_message' } })
  const nome = lead.contact?.name?.split(' ')[0] ?? ''
  const msg = (cfg?.value || DEFAULT_BUDGET_FOLLOWUP).replace(/\{nome\}/gi, nome)
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
}

/** Fallback de AC: cliente não informou as horas em 30 min → manda 2 orçamentos (sem AC e com AC 8h). */
async function handleAcFollowup(a: { leadId: string; conversationId: string; payload: unknown }) {
  const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
  if (!lead || lead.humanOnly) return
  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
  const ac = cf.ac as { units?: number; btu?: number; hoursPerDay?: number | null } | undefined
  if (!ac?.btu) return
  if (ac.hoursPerDay != null) return // cliente já informou as horas → não precisa do fallback

  const baseKwh = typeof cf.consumoKwh === 'number' ? cf.consumoKwh : null
  const { calcularSolarPorKwh, resumoParaIA } = await import('./solar-calc')
  const { consumoAcKwhMes } = await import('./ac-calc')
  const acKwh = consumoAcKwhMes(ac.btu, 8, ac.units ?? 1)

  let msg: string
  if (baseKwh != null) {
    const semAc = calcularSolarPorKwh(baseKwh)
    const comAc = calcularSolarPorKwh(baseKwh + acKwh)
    msg = `Como não consegui as horas de uso, vou te passar duas opções 😊 (considerei *8h/dia*, que é a média de uso das pessoas):\n\n` +
      `*1) Sem o ar-condicionado* — sistema ${ 'R$ ' + semAc.valorSistema.toLocaleString('pt-BR') }\n${resumoParaIA(semAc)}\n\n` +
      `*2) Com o ar-condicionado* (+${acKwh} kWh/mês) — sistema ${ 'R$ ' + comAc.valorSistema.toLocaleString('pt-BR') }\n${resumoParaIA(comAc)}\n\n` +
      `Se me disser quantas horas por dia pretende usar, ajusto certinho!`
  } else {
    msg = `Sobre o ar-condicionado: considerando *8h/dia* (média de uso), ele acrescenta cerca de *${acKwh} kWh/mês* no consumo. ` +
      `Me manda sua conta de luz (ou o consumo médio) que eu já te passo o orçamento com e sem o ar 😊`
  }
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
  await prisma.note.create({ data: { leadId: a.leadId, type: 'system', content: 'AC: cliente não informou horas em 30 min — enviados orçamentos com/sem AC (8h padrão).' } })
}

/** Move o lead por inatividade — só se ele não respondeu e ainda está na etapa. */
async function handleNoReply(a: { id: string; leadId: string; conversationId: string; createdAt: Date; payload: unknown }) {
  const p = (a.payload as { fromStageId?: string; targetStageId?: string }) ?? {}
  if (!p.fromStageId || !p.targetStageId) return

  const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
  if (!lead || lead.stageId !== p.fromStageId) return // já mudou de etapa → ignora

  // Cliente respondeu depois que a checagem foi agendada? → não move
  const inbound = await prisma.message.count({
    where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } },
  })
  if (inbound > 0) return

  const target = await prisma.stage.findUnique({ where: { id: p.targetStageId } })
  if (!target) return

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({
    data: { leadId: lead.id, type: 'stage_change', content: `Movido automaticamente para "${target.name}" por inatividade do cliente.` },
  })
  // dispara a chamada da nova etapa
  await enterStage(lead.id, target.id).catch(() => {})
}

/** Lembrete de agendamento: cria tarefa para o consultor + envia mensagem de confirmação ao cliente. */
async function handleAppointmentReminder(a: { leadId: string; conversationId: string; payload: unknown }) {
  const pl = (a.payload as { appointmentId?: string }) ?? {}
  if (!pl.appointmentId) return
  const appt = await prisma.appointment.findUnique({
    where: { id: pl.appointmentId },
    include: { lead: { include: { contact: true } } },
  })
  if (!appt || appt.status !== 'scheduled') return

  const channelLabel = appt.channel === 'phone' ? 'ligação' : appt.channel === 'video' ? 'videochamada' : appt.channel === 'visit' ? 'visita técnica' : 'conversa pelo WhatsApp'
  const channelIcon  = appt.channel === 'phone' ? '📞' : appt.channel === 'video' ? '🎥' : appt.channel === 'visit' ? '🏠' : '💬'
  const hora = appt.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const data = appt.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const nome = appt.lead.contact?.name?.split(' ')[0] ?? ''

  // 1) Tarefa de lembrete para o consultor
  const channelLabelTask = appt.channel === 'phone' ? 'Ligação' : appt.channel === 'video' ? 'Videochamada' : appt.channel === 'visit' ? 'Visita técnica' : 'WhatsApp'
  await prisma.task.create({
    data: {
      leadId: appt.leadId,
      title: `🔔 LEMBRETE: ${channelLabelTask} com ${appt.lead.contact?.name ?? appt.lead.title} às ${hora} (${data}) — em 2h`,
      type: 'call',
      dueAt: appt.scheduledAt,
    },
  })

  // 2) Mensagem de confirmação ao cliente
  const saudacao = nome ? `${nome}, ` : ''
  const msg = `${channelIcon} ${saudacao}passando para confirmar nossa ${channelLabel} de hoje às *${hora}*. Você confirma? 😊`
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai')

  // Guarda o ID do agendamento no lead para o agente saber que há confirmação pendente
  const cf = (appt.lead.customFields as Record<string, unknown> | null) ?? {}
  await prisma.lead.update({
    where: { id: appt.leadId },
    data: { customFields: { ...cf, pendingAppointmentId: appt.id, pendingAppointmentAt: appt.scheduledAt.toISOString() } as object },
  })

  await prisma.appointment.update({ where: { id: appt.id }, data: { remindedAt: new Date() } })
}

/** Inicia o poller único (sobrevive ao HMR via global). */
export function startScheduler() {
  const g = globalThis as unknown as { __crmScheduler?: NodeJS.Timeout; __crmSchedulerRunning?: boolean }
  if (g.__crmScheduler) return
  g.__crmScheduler = setInterval(() => {
    // Evita rodadas CONCORRENTES: se a anterior ainda está rodando (delays de digitação
    // podem passar de 15s), pula esta — senão duas rodadas processam a mesma ação e DUPLICAM.
    if (g.__crmSchedulerRunning) return
    g.__crmSchedulerRunning = true
    processDueActions().catch(() => {}).finally(() => { g.__crmSchedulerRunning = false })
  }, 15000)
}
