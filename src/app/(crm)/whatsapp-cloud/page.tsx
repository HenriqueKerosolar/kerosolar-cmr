import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { WhatsappCloudStatus } from './status-client'

export const dynamic = 'force-dynamic'

export default async function WhatsappCloudPage() {
  await verifySession()
  const rows = await prisma.whatsappTemplate.findMany({ orderBy: { createdAt: 'asc' } })
  const templates = rows.map((t) => ({
    id: t.id,
    name: t.name,
    displayName: t.displayName,
    category: t.category,
    language: t.language,
    metaStatus: t.metaStatus,
    actionType: t.actionType,
    lastSyncAt: t.lastSyncAt?.toISOString() ?? null,
  }))
  return <WhatsappCloudStatus templates={templates} />
}
