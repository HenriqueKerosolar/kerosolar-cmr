import 'server-only'
import { prisma } from '@/lib/prisma'
import { pedeHibrido } from './solar-calc'

/**
 * 🔋 O lead quer equipamento HÍBRIDO (com bateria)? (regra do dono, 2026-11-11 → valor × 240%)
 * Olha: flag já guardada no lead, o texto atual e as últimas mensagens do cliente nesta conversa
 * (o pedido costuma vir numa mensagem ANTERIOR). Guarda a flag no lead quando descobre.
 */
export async function leadQuerHibrido(leadId: string, conversationId: string | null, textoAtual = ''): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  if (cf.hibrido === true) return true
  let quer = pedeHibrido(textoAtual)
  if (!quer && conversationId) {
    const msgs = await prisma.message.findMany({
      where: { conversationId, direction: 'inbound' }, orderBy: { createdAt: 'desc' }, take: 15, select: { content: true },
    })
    quer = msgs.some((m) => pedeHibrido(m.content ?? ''))
  }
  if (quer) await prisma.lead.update({ where: { id: leadId }, data: { customFields: { ...cf, hibrido: true } as object } }).catch(() => {})
  return quer
}
