import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ensureDefaultPipeline } from '@/lib/crm/engine'
import { FunisClient } from './funis-client'

export const dynamic = 'force-dynamic'

export default async function FunisPage() {
  await verifySession()
  await ensureDefaultPipeline()

  const [pipelines, accounts] = await Promise.all([
    prisma.pipeline.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },  // inclui flow (Json) automaticamente
        whatsappAccounts: { select: { accountId: true } },
        _count: { select: { leads: true } },
      },
    }),
    prisma.whatsappAccount.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  return <FunisClient pipelines={JSON.parse(JSON.stringify(pipelines))} accounts={JSON.parse(JSON.stringify(accounts))} />
}
