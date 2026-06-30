import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { TemplatesClient } from './templates-client'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  await verifySession()
  const rows = await prisma.whatsappTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  const templates = rows.map((t) => ({
    ...t,
    lastSyncAt: t.lastSyncAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }))
  return <TemplatesClient initial={templates} />
}
