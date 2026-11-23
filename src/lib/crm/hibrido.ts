import 'server-only'
import { prisma } from '@/lib/prisma'
import { pedeHibrido, pedeOnGrid } from './solar-calc'

/**
 * 🔋 O lead quer equipamento HÍBRIDO (com bateria)? (regra do dono, 2026-11-11 → valor × 240%)
 * Olha: flag já guardada no lead, o texto atual e as últimas mensagens do cliente nesta conversa
 * (o pedido costuma vir numa mensagem ANTERIOR). Guarda a flag no lead quando descobre.
 */
export async function leadQuerHibrido(leadId: string, conversationId: string | null, textoAtual = ''): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  // A mensagem MAIS RECENTE que fala do tipo decide (23/11/2026: a Valessa pediu híbrido e depois "on grid").
  if (pedeHibrido(textoAtual)) return marcar(true)
  if (pedeOnGrid(textoAtual)) return marcar(false)
  if (conversationId) {
    const msgs = await prisma.message.findMany({
      where: { conversationId, direction: 'inbound' }, orderBy: { createdAt: 'desc' }, take: 15, select: { content: true },
    })
    for (const m of msgs) {
      if (pedeOnGrid(m.content ?? '')) return marcar(false)
      if (pedeHibrido(m.content ?? '')) return marcar(true)
    }
  }
  return cf.hibrido === true

  async function marcar(v: boolean) {
    if ((cf.hibrido === true) !== v)
      await prisma.lead.update({ where: { id: leadId }, data: { customFields: { ...cf, hibrido: v } as object } }).catch(() => {})
    return v
  }
}
