import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { AprendizadoClient } from './aprendizado-client'

export const dynamic = 'force-dynamic'

export default async function AprendizadoPage() {
  await verifySession()
  const rows = await prisma.learnedAnswer.findMany({
    orderBy: [{ useCount: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    select: { id: true, question: true, answer: true, useCount: true, createdAt: true },
  })
  // Sugestão da revisão automática (id → motivo para apagar), guardada em system_configs
  let sugestoes: Record<string, string> = {}
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'learning_review' } })
    if (cfg?.value) sugestoes = JSON.parse(cfg.value) as Record<string, string>
  } catch { /* sem sugestões */ }
  const items = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sugestaoApagar: sugestoes[r.id] ?? null }))
  return <AprendizadoClient items={items} />
}
