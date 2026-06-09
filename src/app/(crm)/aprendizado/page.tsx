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
  const items = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  return <AprendizadoClient items={items} />
}
