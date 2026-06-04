import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ConfigClient } from './config-client'

export const dynamic = 'force-dynamic'

export default async function ConfigPage() {
  await verifySession()
  const rows = await prisma.systemConfig.findMany()
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return <ConfigClient initial={cfg} />
}
