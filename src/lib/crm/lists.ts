import 'server-only'
import { prisma } from '@/lib/prisma'

export type ListKind = 'no_send' | 'no_receive'

/** Normaliza um número: só dígitos, com DDI 55 quando for número BR sem código do país. */
export function normalizarNumero(raw: string): string {
  const d = (raw || '').replace(/\D/g, '')
  if (!d) return ''
  return d.length <= 11 ? `55${d}` : d
}

/** O número está na lista (no_send = black / no_receive = block)? */
export async function numeroNaLista(raw: string, kind: ListKind): Promise<boolean> {
  const phone = normalizarNumero(raw)
  if (!phone) return false
  const hit = await prisma.numberRule.findFirst({ where: { phone, kind }, select: { id: true } })
  return !!hit
}

/** Adiciona um número a uma lista (idempotente). */
export async function addNaLista(raw: string, kind: ListKind, reason?: string): Promise<void> {
  const phone = normalizarNumero(raw)
  if (!phone) return
  await prisma.numberRule.upsert({
    where: { phone_kind: { phone, kind } },
    create: { phone, kind, reason: reason ?? null },
    update: { reason: reason ?? undefined },
  })
}

/** Remove um número de uma lista. */
export async function removeDaLista(phone: string, kind: ListKind): Promise<void> {
  await prisma.numberRule.deleteMany({ where: { phone: normalizarNumero(phone), kind } })
}

/** Lista os números de um tipo. */
export async function listar(kind: ListKind) {
  return prisma.numberRule.findMany({ where: { kind }, orderBy: { createdAt: 'desc' } })
}
