'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'
import { dispatchOutbound, enterStage } from '@/lib/crm/flow'

/**
 * Simula uma mensagem do cliente entrando (inbound) — uso exclusivo do agente
 * para testar o bot dentro de qualquer etapa sem precisar abrir o Simulador.
 */
export async function simulateClientMessage(leadId: string, text: string) {
  await verifySession()
  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' } })
  if (!conv) throw new Error('Esse lead ainda não tem conversa.')
  const leadRow = await prisma.lead.findUnique({ where: { id: leadId }, select: { contactId: true, pipelineId: true } })
  const contact = leadRow?.contactId ? await prisma.contact.findUnique({ where: { id: leadRow.contactId } }) : null
  const { ingestMessage } = await import('@/lib/crm/engine')
  await ingestMessage({
    channel: conv.channel,
    externalId: (conv.externalId || contact?.phone || leadId) as string,
    text,
    name: contact?.name ?? undefined,
    phone: contact?.phone ?? undefined,
    pipelineId: leadRow?.pipelineId ?? null,
  })
  revalidatePath(`/leads/${leadId}`)
}

/** Cria um lead manualmente (lançamento pelo atendente). */
export async function createManualLead(data: {
  name?: string; phone?: string; email?: string
  pipelineId: string; stageId: string; value?: number; startBot?: boolean
}) {
  await verifySession()
  const phoneRaw = data.phone?.replace(/\D/g, '') || null
  // Normaliza com DDI 55 (número BR sem código do país não é entregável no WhatsApp)
  const phone = phoneRaw
    ? (phoneRaw.length <= 11 ? `55${phoneRaw}` : phoneRaw)
    : null
  const name = data.name?.trim() || null

  // contato por telefone (cria se não existir)
  let contact = phone
    ? await prisma.contact.findFirst({ where: { OR: [{ phone }, { whatsappId: phone }] } })
    : null
  if (!contact) {
    contact = await prisma.contact.create({
      data: { name, phone, whatsappId: phone, email: data.email?.trim() || null },
    })
  } else {
    const upd: Record<string, string> = {}
    if (name && !contact.name) upd.name = name
    if (data.email?.trim() && !contact.email) upd.email = data.email.trim()
    if (Object.keys(upd).length) contact = await prisma.contact.update({ where: { id: contact.id }, data: upd })
  }

  const lead = await prisma.lead.create({
    data: {
      title: name || phone || 'Lead manual',
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      contactId: contact.id,
      value: data.value ?? 0,
      // Lead manual com telefone é atendível pelo WhatsApp → mostra o selo verde no card
      source: phone ? 'whatsapp' : null,
    },
  })

  // conversa (WhatsApp) pra poder atender pelo card
  let conversationId: string | null = null
  if (phone) {
    // Conta de WhatsApp para enviar: a conectada (preferência) ou a primeira cadastrada.
    // Sem accountId a conversa não consegue despachar mensagens pelo WhatsApp.
    const waAccount =
      (await prisma.whatsappAccount.findFirst({ where: { status: 'connected' }, orderBy: { connectedAt: 'desc' } }))
      ?? (await prisma.whatsappAccount.findFirst({ orderBy: { createdAt: 'asc' } }))
    const accountId = waAccount?.id ?? null

    const existing = await prisma.conversation.findUnique({
      where: { channel_contactId: { channel: 'whatsapp', contactId: contact.id } },
    })
    if (!existing) {
      const created = await prisma.conversation.create({ data: { channel: 'whatsapp', contactId: contact.id, leadId: lead.id, externalId: phone, accountId } })
      conversationId = created.id
    } else {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { leadId: lead.id, ...(existing.accountId ? {} : { accountId }) },
      })
      conversationId = existing.id
    }
  }

  await prisma.note.create({ data: { leadId: lead.id, type: 'system', content: 'Lead criado manualmente.' } })

  // Aciona o bot/fluxo da etapa (trata como lead novo) se solicitado e houver telefone.
  // Se a etapa tem fluxo de abertura próprio (mensagens/blocos) → enterStage o executa.
  // Se NÃO tem (ex.: "Chegada", cuja saudação vem do motor) → envia a saudação de boas-vindas
  // manualmente, senão o lead manual ficaria parado sem receber nada.
  if (data.startBot && phone && conversationId) {
    const stage = await prisma.stage.findUnique({ where: { id: data.stageId } })
    const flow = (stage?.flow as { openingMessages?: unknown[]; blocks?: unknown[] } | null) ?? null
    const temAbertura = !!(flow?.openingMessages?.length || flow?.blocks?.length)
    // ⚠️ NÃO await: o envio da saudação vai pelo WhatsApp e pode demorar/travar. A ação precisa
    // RETORNAR já (lead criado) pra tela fechar e mostrar o lead — senão parece que "não fez nada"
    // e o operador clica de novo, duplicando. O servidor é persistente, então o envio segue em
    // segundo plano; se falhar, o dispatchOutbound re-enfileira (redeliver).
    if (temAbertura) {
      void enterStage(lead.id, data.stageId).catch((e) => console.error('[manual startBot]', e))
    } else {
      const { iniciarSaudacaoManual } = await import('@/lib/crm/flow')
      void iniciarSaudacaoManual(lead.id, conversationId, data.stageId).catch((e) => console.error('[manual saudacao]', e))
    }
  }

  revalidatePath('/leads')
  return lead.id
}

/** Atendente envia uma mensagem manual (texto e/ou mídia por URL). */
export async function sendManualMessage(leadId: string, text: string, media?: { url: string; type: 'image' | 'video' | 'document' }, accountId?: string) {
  const session = await verifySession()
  let conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' } })
  if (!conv) {
    // Lead criado manualmente ainda sem conversa → cria uma na hora (se tiver telefone)
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
    const phone = (lead?.contact?.phone ?? '').replace(/\D/g, '')
    if (!lead?.contactId || !phone) throw new Error('Esse lead não tem telefone cadastrado — adicione um telefone ao contato primeiro.')
    const account = accountId
      ? await prisma.whatsappAccount.findUnique({ where: { id: accountId } })
      : await prisma.whatsappAccount.findFirst({ where: { status: 'connected' }, orderBy: { provider: 'asc' } })
    conv = await prisma.conversation.upsert({
      where: { channel_contactId: { channel: 'whatsapp', contactId: lead.contactId } },
      update: { leadId },
      create: { channel: 'whatsapp', contactId: lead.contactId, leadId, accountId: account?.id ?? null, externalId: phone },
    })
  }

  // 🧮 COMANDO DO OPERADOR: "minha indicação é XXXX kWh" → calcula e envia o orçamento (em vez
  // do texto literal). Vale em qualquer etapa. (Mesma função usada no app do WhatsApp.)
  if (text && !media) {
    const { comandoIndicacaoKwh } = await import('@/lib/crm/flow')
    if (await comandoIndicacaoKwh(leadId, conv.id, text)) {
      revalidatePath(`/leads/${leadId}`)
      return
    }
  }

  await dispatchOutbound(conv.id, text, media, 'human', session.userId, false, undefined, accountId)
  await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
  // 📚 Aprende com a resposta do atendente (pergunta do cliente → resposta dada)
  if (text?.trim().length >= 8) {
    const { aprenderResposta } = await import('@/lib/crm/learning')
    aprenderResposta(conv.id, text).catch(() => {})
  }
  revalidatePath(`/leads/${leadId}`)
}

/** Liga/desliga a IA para este lead (atendente assume ou devolve pro bot). */
export async function toggleLeadAi(leadId: string, enabled: boolean) {
  await verifySession()
  // ao reativar, libera o bloqueio total (humanOnly)
  await prisma.lead.update({ where: { id: leadId }, data: { aiEnabled: enabled, ...(enabled ? { humanOnly: false } : {}) } })
  const conv = await prisma.conversation.findFirst({ where: { leadId } })
  if (conv) await prisma.conversation.update({ where: { id: conv.id }, data: { aiEnabled: enabled } })
  // Ao DESLIGAR a IA: cancela follow-ups/reengajamento/cobranças pendentes (nada do bot dispara)
  if (!enabled) {
    await prisma.scheduledAction.updateMany({ where: { leadId, done: false }, data: { done: true } })
  }
  await prisma.note.create({ data: { leadId, type: 'system', content: enabled ? 'IA reativada (bloqueio liberado).' : 'Atendente assumiu a conversa.' } })
  revalidatePath(`/leads/${leadId}`)
}

/** Fecha (resolve) uma conversa no Inbox — some da lista "Precisam de mim".
 *  Volta a aparecer sozinha quando o cliente mandar uma nova mensagem. */
export async function resolveConversation(conversationId: string) {
  await verifySession()
  await prisma.conversation.update({ where: { id: conversationId }, data: { resolvedAt: new Date() } })
  await prisma.message.updateMany({ where: { conversationId, direction: 'inbound', isRead: false }, data: { isRead: true } })
  revalidatePath('/inbox')
}

/** Encerra a conversa: some da lista e a automação NÃO traz de volta.
 *  Cancela follow-ups/reengajamento pendentes. Só reabre quando o cliente
 *  mandar uma nova mensagem (o motor zera o resolvedAt no inbound). */
export async function encerrarConversa(conversationId: string) {
  await verifySession()
  const conv = await prisma.conversation.update({ where: { id: conversationId }, data: { resolvedAt: new Date() } })
  await prisma.message.updateMany({ where: { conversationId, direction: 'inbound', isRead: false }, data: { isRead: true } })
  if (conv.leadId) {
    await prisma.scheduledAction.updateMany({ where: { leadId: conv.leadId, done: false }, data: { done: true } })
    await prisma.note.create({ data: { leadId: conv.leadId, type: 'system', content: 'Conversa encerrada pelo atendente (automação pausada até o cliente voltar).' } })
    revalidatePath(`/leads/${conv.leadId}`)
  }
  revalidatePath('/inbox')
}

/** Move o lead para outra etapa (dispara a chamada da nova etapa). */
export async function moveLeadStage(leadId: string, stageId: string) {
  await verifySession()
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead || lead.stageId === stageId) return
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId,
      status: stage?.isWon ? 'won' : stage?.isLost ? 'lost' : 'open',
      closedAt: stage?.isWon || stage?.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({ data: { leadId, type: 'stage_change', content: `Movido para "${stage?.name}".` } })

  // 🆕 CTWA: venda ganha → manda Purchase pra Meta com o valor, ligado ao clique do anúncio.
  if (stage?.isWon) {
    try {
      const full = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { contact: true, conversations: { include: { account: true }, take: 1 } },
      })
      const clid = (full?.contact as { ctwaClid?: string | null } | null)?.ctwaClid ?? null
      if (clid) {
        const wabaId = full?.conversations?.[0]?.account?.cloudWabaId ?? null
        const { sendCapiEvent } = await import('@/lib/crm/capi')
        void sendCapiEvent({
          eventName: 'Purchase',
          ctwaClid: clid,
          wabaId,
          value: full?.value || 0,
          currency: 'BRL',
          phone: full?.contact?.phone ?? null,
          eventId: `${leadId}:purchase`,
        }).catch(() => {})
      }
    } catch (e) {
      console.error('[capi] purchase no won falhou (ignorado):', e)
    }
  }

  await enterStage(leadId, stageId).catch(() => {})
  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
}

/** Apaga o lead e tudo ligado a ele (conversas, mensagens, tarefas, notas, agendamentos). */
export async function deleteLead(leadId: string) {
  await verifySession()
  await prisma.$transaction([
    prisma.scheduledAction.deleteMany({ where: { leadId } }),
    prisma.conversation.deleteMany({ where: { leadId } }), // cascata: mensagens
    prisma.lead.delete({ where: { id: leadId } }),          // cascata: tarefas, notas
  ])
  revalidatePath('/leads')
}

/** Apaga TODOS os leads de uma etapa (e tudo ligado: conversas, mensagens, tarefas, notas,
 *  agendamentos). Os CONTATOS são mantidos. Uso: limpar o banco depois de exportar a etapa. */
export async function deleteLeadsByStage(stageId: string): Promise<number> {
  await verifySession()
  const ids = (await prisma.lead.findMany({ where: { stageId }, select: { id: true } })).map((l) => l.id)
  if (!ids.length) return 0
  await prisma.$transaction([
    prisma.scheduledAction.deleteMany({ where: { leadId: { in: ids } } }),
    prisma.conversation.deleteMany({ where: { leadId: { in: ids } } }), // cascata: mensagens
    prisma.lead.deleteMany({ where: { id: { in: ids } } }),             // cascata: tarefas, notas
  ])
  revalidatePath('/leads')
  return ids.length
}

export async function updateLeadValue(leadId: string, value: number) {
  await verifySession()
  await prisma.lead.update({ where: { id: leadId }, data: { value } })
  revalidatePath(`/leads/${leadId}`)
}

export async function addNote(leadId: string, content: string) {
  const session = await verifySession()
  if (!content.trim()) return
  await prisma.note.create({ data: { leadId, type: 'note', content: content.trim(), authorId: session.userId } })
  revalidatePath(`/leads/${leadId}`)
}

export async function addTask(leadId: string, title: string, dueAt?: string) {
  const session = await verifySession()
  if (!title.trim()) return
  await prisma.task.create({
    data: { leadId, title: title.trim(), responsibleId: session.userId, dueAt: dueAt ? new Date(dueAt) : null },
  })
  revalidatePath(`/leads/${leadId}`)
}

export async function completeTask(taskId: string) {
  await verifySession()
  const t = await prisma.task.findUnique({ where: { id: taskId } })
  await prisma.task.update({ where: { id: taskId }, data: { status: 'completed', completedAt: new Date() } })
  if (t) revalidatePath(`/leads/${t.leadId}`)
}
