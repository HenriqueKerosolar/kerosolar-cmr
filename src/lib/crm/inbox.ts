import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Regra ÚNICA do Inbox — usada TANTO pela versão desktop (/inbox) QUANTO pelo
 * app de atendimento do celular (/api/app/conversations). Assim as duas telas
 * são idênticas: mesma lista, mesma ordem, mesmos critérios.
 *
 * Aparecem no Inbox as conversas que precisam de você:
 *   1. Cliente pediu atendente / IA desligada (humanOnly ou aiEnabled=false)
 *   2. Cliente NOVO (lead criado nos últimos dias)
 *   3. Tem mensagem do cliente ainda não lida (qualquer uma, em qualquer etapa — mesmo já respondida pela IA)
 * Sempre com INTERAÇÃO real (o cliente enviou ao menos 1 mensagem) e NÃO encerrada.
 */

const CLIENTE_NOVO_DIAS = 3

const inboxInclude = {
  contact: true,
  lead: { include: { stage: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  // mensagens do cliente que o operador ainda NÃO viu (em qualquer posição da conversa)
  _count: { select: { messages: { where: { direction: 'inbound' as const, isRead: false } } } },
}

type InboxConv = Awaited<ReturnType<typeof buscarBase>>[number]

function buscarBase() {
  return prisma.conversation.findMany({
    // Encerradas somem dos dois lugares; só conversas com mensagem recebida do cliente.
    where: { resolvedAt: null, messages: { some: { direction: 'inbound' } } },
    orderBy: { lastMessageAt: 'asc' }, // mais antigos primeiro (fila de espera)
    take: 300,
    include: inboxInclude,
  })
}

export function clienteNovo(conv: InboxConv): boolean {
  if (!conv.lead) return false
  return Date.now() - new Date(conv.lead.createdAt).getTime() < CLIENTE_NOVO_DIAS * 86400000
}

/** Precisa de atenção do operador? (a regra que decide o que entra no Inbox) */
export function precisaAtencao(conv: InboxConv): boolean {
  return (
    conv.lead?.humanOnly === true ||
    conv.lead?.aiEnabled === false ||
    // Regra do dono (2026-11-10): mensagem NOVA do cliente → vai para o Inbox, em QUALQUER etapa
    // (inclusive "Leads adquiridos") e mesmo que a IA já tenha respondido. Sai quando o operador
    // abre a conversa (marca como lida) ou fecha a conversa.
    (conv._count?.messages ?? 0) > 0 ||
    clienteNovo(conv)
  )
}

/** Lista do Inbox já filtrada e ordenada (prioridade máxima no topo, depois mais antigo→novo). */
export async function listarInbox(): Promise<InboxConv[]> {
  const all = await buscarBase()
  return all
    .filter(precisaAtencao)
    .sort((a, b) => Number(b.lead?.highPriority ?? false) - Number(a.lead?.highPriority ?? false))
}

/** Quantas conversas precisam de atenção agora (para o badge/sinalização de novas entradas). */
export async function contarInbox(): Promise<number> {
  const all = await buscarBase()
  return all.filter(precisaAtencao).length
}
