import 'server-only'
import { prisma } from '@/lib/prisma'
import { dispatchOutbound, moveLeadToStage } from './flow'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Motor de fluxo por blocos (estilo Salesbot do Kommo, em lista sequencial).
 * O fluxo de uma etapa fica em stage.flow.blocks (array). Executa bloco a bloco;
 * blocos que esperam (wait/question) pausam e retomam depois.
 *
 * Estado em conversation.flowState = { stageId, index, waitingField }
 */

export type FlowBlock =
  | { id: string; type: 'message'; text: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }
  | { id: string; type: 'wait'; minutes: number }
  | { id: string; type: 'question'; text: string; field: string }
  | { id: string; type: 'condition'; source: 'field' | 'reply'; field?: string; op: 'contains' | 'equals'; value: string; gotoId: string }
  | { id: string; type: 'move_stage'; targetStageId: string }
  | { id: string; type: 'task'; title: string }
  | { id: string; type: 'notify' }
  | { id: string; type: 'ai' }
  | { id: string; type: 'handoff' }

type FlowState = { stageId: string; index: number; waitingField: string | null }

const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

async function getBlocks(stageId: string): Promise<FlowBlock[]> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const flow = stage?.flow as { blocks?: FlowBlock[] } | null
  return flow?.blocks ?? []
}

type NoReply = { minutes: number; message?: string; targetStageName?: string; moveImmediately?: boolean }
async function getNoReply(stageId: string): Promise<NoReply | null> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const flow = stage?.flow as { noReply?: NoReply } | null
  return flow?.noReply && flow.noReply.minutes > 0 ? flow.noReply : null
}

/** Agenda a checagem "sem resposta" (em pergunta de bloco OU após resposta da IA). */
export async function scheduleNoReply(leadId: string, conversationId: string, stageId: string, isSimulator = false) {
  if (isSimulator) return
  const nr = await getNoReply(stageId)
  if (!nr) return
  await prisma.scheduledAction.updateMany({ where: { leadId, type: 'flow_noreply', done: false }, data: { done: true } })
  await prisma.scheduledAction.create({
    data: { leadId, conversationId, stageId, type: 'flow_noreply', payload: { step: 1 } as any, runAt: new Date(Date.now() + nr.minutes * 60000) },
  })
}

/** Processa a checagem "sem resposta" (chamado pelo agendador). 2 passos: msg → mover etapa. */
export async function handleFlowNoReply(action: { leadId: string; conversationId: string; stageId: string | null; payload: unknown; createdAt: Date }) {
  if (!action.stageId) return
  const lead = await prisma.lead.findUnique({ where: { id: action.leadId } })
  if (!lead || lead.humanOnly || lead.stageId !== action.stageId) return // já mudou de etapa → não move

  // Cliente respondeu depois que a checagem foi agendada? → cancela
  const inbound = await prisma.message.count({
    where: { conversationId: action.conversationId, direction: 'inbound', createdAt: { gt: action.createdAt } },
  })
  if (inbound > 0) return

  const nr = await getNoReply(action.stageId)
  if (!nr) return

  // ⚠️ As travas abaixo valem SÓ quando o destino é "Não respondeu o anúncio" — esse balde
  // é exclusivo de quem entrou e NÃO respondeu nada. Para outros destinos (ex.: Repescagem,
  // que recebe inclusive quem já tem orçamento e sumiu) NÃO bloqueamos o movimento.
  const ehNaoRespondeu = /n[aã]o respondeu/i.test(nr.targetStageName || '')
  if (ehNaoRespondeu) {
    // 2+ mensagens = lead ativo (fez perguntas, enviou conta) → não joga no "não respondeu"
    const totalInbound = await prisma.message.count({
      where: { conversationId: action.conversationId, direction: 'inbound' },
    })
    if (totalInbound > 1) return
    // já tem qualificação solar (conta, kWh, orçamento) → também não joga nesse balde
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    if (cf.solar || cf.billValue || cf.consumoKwh) return
  }
  const step = (action.payload as { step?: number })?.step ?? 1
  // moveImmediately: 1 passo só (transfere direto, sem mensagem intermediária)
  if (step === 1 && !nr.moveImmediately) {
    if (nr.message) await dispatchOutbound(action.conversationId, nr.message, undefined, 'ai')
    await prisma.scheduledAction.create({
      data: { leadId: action.leadId, conversationId: action.conversationId, stageId: action.stageId, type: 'flow_noreply', payload: { step: 2 } as any, runAt: new Date(Date.now() + nr.minutes * 60000) },
    })
  } else {
    // ainda sem resposta (ou transferência direta) → move pra etapa de destino
    await setState(action.conversationId, null)
    if (nr.targetStageName) {
      const target = await prisma.stage.findFirst({ where: { name: { equals: nr.targetStageName, mode: 'insensitive' } } })
      if (target) {
        // 📞 Lead que JÁ recebeu orçamento e sumiu é valioso → antes de "arquivar" na Repescagem,
        //    cria uma TAREFA e marca prioridade pra um humano tentar retomar o contato.
        const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
        if (cf.solar || cf.billValue || cf.consumoKwh) {
          await prisma.lead.update({ where: { id: action.leadId }, data: { highPriority: true } }).catch(() => {})
          await prisma.task.create({
            data: { leadId: action.leadId, title: '📞 Orçamento sem retorno — retomar contato com o cliente', type: 'call', dueAt: new Date() },
          }).catch(() => {})
        }
        await moveLeadToStage(action.leadId, target.id, `Sem resposta — movido para "${target.name}".`)
      }
    }
  }
}

async function setState(conversationId: string, state: FlowState | null) {
  await prisma.conversation.update({ where: { id: conversationId }, data: { flowState: state as any } })
}

/** Inicia o fluxo de blocos da etapa (quando o lead entra). */
export async function startBlockFlow(leadId: string, conversationId: string, stageId: string, isSimulator = false) {
  const blocks = await getBlocks(stageId)
  if (!blocks.length) return false
  await runFrom(leadId, conversationId, stageId, 0, null, isSimulator)
  return true
}

/** Retoma o fluxo quando o cliente responde uma pergunta. */
export async function resumeOnReply(conversationId: string, leadId: string, text: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } })
  const st = conv?.flowState as FlowState | null
  if (!st || !st.waitingField) return false
  // Estado preso de uma etapa antiga? (lead já foi movido) → limpa e deixa a IA responder.
  const leadNow = await prisma.lead.findUnique({ where: { id: leadId }, select: { stageId: true } })
  if (leadNow && st.stageId !== leadNow.stageId) {
    await setState(conversationId, null)
    return false
  }
  // cliente respondeu → cancela checagens "sem resposta" pendentes
  await prisma.scheduledAction.updateMany({ where: { leadId, type: 'flow_noreply', done: false }, data: { done: true } })
  // salva a resposta no campo do lead
  const isSimulator = conv?.channel === 'simulator'
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  cf[st.waitingField] = text
  await prisma.lead.update({ where: { id: leadId }, data: { customFields: cf as any } })
  await runFrom(leadId, conversationId, st.stageId, st.index, text, isSimulator)
  return true
}

/** Retoma após um bloco "wait" (chamado pelo agendador). */
export async function resumeAfterWait(conversationId: string, leadId: string, stageId: string, index: number) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } })
  const st = conv?.flowState as FlowState | null
  // só retoma se ainda estiver no mesmo ponto (não mudou de etapa nem respondeu)
  if (!st || st.stageId !== stageId || st.index !== index || st.waitingField) return
  const isSimulator = conv?.channel === 'simulator'
  await runFrom(leadId, conversationId, stageId, index, null, isSimulator)
}

function findIndexById(blocks: FlowBlock[], id: string): number {
  return blocks.findIndex((b) => b.id === id)
}

/** Caminha pelos blocos a partir de `start`. lastReply = última resposta do cliente (p/ condição). */
async function runFrom(leadId: string, conversationId: string, stageId: string, start: number, lastReply: string | null, isSimulator = false) {
  const blocks = await getBlocks(stageId)
  let i = start
  let guard = 0
  while (i < blocks.length && guard++ < 100) {
    const b = blocks[i]
    switch (b.type) {
      case 'message': {
        const texto = await fill(b.text, leadId)
        await new Promise((r) => setTimeout(r, Math.min(6000, 700 + texto.length * 30))) // simula digitação
        await dispatchOutbound(conversationId, texto, b.mediaUrl ? { url: b.mediaUrl, type: b.mediaType ?? 'image' } : undefined, 'ai')
        i++
        break
      }
      case 'wait': {
        if (isSimulator) { i++; break } // no simulador: pula o delay e continua o fluxo
        await setState(conversationId, { stageId, index: i + 1, waitingField: null })
        await prisma.scheduledAction.create({
          data: { leadId, conversationId, stageId, type: 'flow_continue', payload: { stageId, index: i + 1 } as any, runAt: new Date(Date.now() + (b.minutes || 0) * 60000) },
        })
        return
      }
      case 'question': {
        await dispatchOutbound(conversationId, await fill(b.text, leadId), undefined, 'ai')
        await setState(conversationId, { stageId, index: i + 1, waitingField: b.field })
        await scheduleNoReply(leadId, conversationId, stageId, isSimulator)
        return // pausa esperando a resposta
      }
      case 'condition': {
        let base = ''
        if (b.source === 'reply') base = lastReply ?? ''
        else {
          const lead = await prisma.lead.findUnique({ where: { id: leadId } })
          const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
          base = String(cf[b.field ?? ''] ?? '')
        }
        const match = b.op === 'equals' ? norm(base) === norm(b.value) : norm(base).includes(norm(b.value))
        if (match) {
          const j = findIndexById(blocks, b.gotoId)
          i = j >= 0 ? j : i + 1
        } else i++
        break
      }
      case 'move_stage': {
        await setState(conversationId, null)
        await moveLeadToStage(leadId, b.targetStageId, 'Movido pelo fluxo (bloco).')
        return
      }
      case 'task': {
        await prisma.task.create({ data: { leadId, title: b.title || 'Tarefa do fluxo', type: 'followup', dueAt: new Date() } })
        i++
        break
      }
      case 'notify': {
        await prisma.lead.update({ where: { id: leadId }, data: { highPriority: true } })
        await prisma.task.create({ data: { leadId, title: '🔔 Lead sinalizado pelo fluxo', type: 'call', dueAt: new Date() } })
        i++
        break
      }
      case 'ai': {
        await setState(conversationId, null) // entrega pra IA: próximas mensagens vão pro agente
        // Se a etapa tem "sem resposta" (ex.: → Repescagem), arma o relógio aqui — senão o
        // lead silencioso ficaria parado pra sempre (não há bloco de pergunta pra armar).
        await scheduleNoReply(leadId, conversationId, stageId, isSimulator)
        return
      }
      case 'handoff': {
        await setState(conversationId, null)
        const { performHandoff } = await import('./handoff')
        await performHandoff(leadId, conversationId, 'Transferido pelo fluxo (bloco)')
        return
      }
      default:
        i++
    }
  }
  await setState(conversationId, null) // fim do fluxo
  // Fluxo terminou sem pausa/IA → ainda assim arma o "sem resposta" da etapa, se houver.
  await scheduleNoReply(leadId, conversationId, stageId, isSimulator)
}

/** Substitui variáveis ({nome}) no texto. */
async function fill(text: string, leadId: string): Promise<string> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  const nome = lead?.contact?.name?.split(' ')[0] ?? ''
  return (text || '').replace(/\{nome\}/gi, nome)
}
