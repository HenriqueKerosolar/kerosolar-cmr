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

  // 🤖 COMANDO DO OPERADOR: "cota belenus <kWp>" (só isso na mensagem) → monta o kit na Belenus (Fase 1: só
  // leitura) e grava uma NOTA INTERNA. O texto do comando NUNCA vai ao cliente; nada é enviado ao cliente.
  if (text && !media) {
    const { lerComandoBelenus } = await import('@/lib/crm/belenus/regras')
    if (lerComandoBelenus(text)) {
      try {
        const { comandoCotaBelenus } = await import('@/lib/crm/belenus/cotar')
        const r = await comandoCotaBelenus(leadId, conv?.id ?? null, text)
        if (r.tratado) {
          revalidatePath(`/leads/${leadId}`)
          return { belenus: r.texto }
        }
      } catch (e) {
        return { erro: e instanceof Error ? e.message : 'Não consegui cotar na Belenus. Nada foi enviado ao cliente.' }
      }
    }
    // 📄 "envia orçamento" (só isso na mensagem) → manda ao cliente o PDF gerado pelo "cota belenus" (como documento,
    // pelo canal da conversa). O texto do comando nunca vai ao cliente.
    const { lerComandoEnviaOrcamento } = await import('@/lib/crm/belenus/orcamento')
    if (lerComandoEnviaOrcamento(text)) {
      try {
        const { comandoEnviaOrcamento } = await import('@/lib/crm/belenus/orcamento-cmd')
        const r = await comandoEnviaOrcamento(leadId, text, session.userId)
        if (r.tratado) {
          revalidatePath(`/leads/${leadId}`)
          return { belenus: r.texto }
        }
      } catch (e) {
        return { erro: e instanceof Error ? e.message : 'Não consegui enviar o orçamento. Nada foi enviado ao cliente.' }
      }
    }
  }

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

  // 🧮 COMANDO DO OPERADOR: "faz XXXX" (só isso na mensagem) → calcula e envia o orçamento (em vez
  // do texto literal). Vale em qualquer etapa. (Mesma função usada no app do WhatsApp.)
  if (text && !media) {
    const { comandoIndicacaoKwh } = await import('@/lib/crm/flow')
    let tratado = false
    try {
      tratado = await comandoIndicacaoKwh(leadId, conv.id, text, session.userId)
    } catch (e) {
      // "faz" incompleto (sem kWh/R$) ou fora da faixa: nada vai ao cliente; a tela mostra o aviso
      return { erro: e instanceof Error ? e.message : 'Não consegui montar o orçamento. Nada foi enviado.' }
    }
    if (tratado) {
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

  // 🆕 Venda ganha: a compra para a Meta (CTWA) e o desfecho para o Mind Marketing (qualificado / venda
  //    ganha / perdida) saem no `enterStage` abaixo — o mesmo caminho da IA e dos fluxos (leadOutcome.ts).

  // ⚡ As mensagens automáticas da etapa nova (com o "tempo de digitação" simulado) saem em SEGUNDO
  //    PLANO — antes o botão esperava tudo terminar e a tela travava de 4 a 30 s por mensagem.
  void enterStage(leadId, stageId).catch((e) => console.error('[moveLeadStage] enterStage', e))
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

/**
 * Valor REAL da venda (pedido do dono, 16/11/2026): o atendente corrige o valor quando o projeto muda.
 * A "Simulação Solar" passa a usar esse valor (parcelas e payback recalculados) e fica marcada como
 * manual — o motor não troca mais por um orçamento automático. É esse valor que vai no lead.won.
 */
export async function updateLeadValue(leadId: string, value: number) {
  const session = await verifySession()
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { value: true, customFields: true } })
  if (!lead || (lead.value ?? 0) === value) return
  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
  const solar = cf.solar as import('@/lib/crm/solar-calc').SolarResult | undefined
  let novoCf = cf
  if (value > 0 && solar && typeof solar.contaReais === 'number') {
    const { ajustarValorVenda, carregarTabelaFinanciamento } = await import('@/lib/crm/solar-calc')
    await carregarTabelaFinanciamento()
    novoCf = { ...cf, solar: ajustarValorVenda(solar, value), valorVendaManual: true }
  } else if (value > 0) {
    novoCf = { ...cf, valorVendaManual: true }
  }
  await prisma.lead.update({ where: { id: leadId }, data: { value, customFields: novoCf as object } })
  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  await prisma.note.create({ data: { leadId, type: 'system', authorId: session.userId, content: `💰 Valor da venda ajustado: ${fmt(lead.value ?? 0)} → ${fmt(value)}.` } }).catch(() => {})
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
