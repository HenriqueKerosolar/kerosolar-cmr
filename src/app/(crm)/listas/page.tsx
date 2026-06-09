import { verifySession } from '@/lib/dal'
import { listar } from '@/lib/crm/lists'
import { ListasClient } from './listas-client'

export const dynamic = 'force-dynamic'

export default async function ListasPage() {
  await verifySession()
  const [black, block] = await Promise.all([listar('no_send'), listar('no_receive')])
  const fmt = (rows: Awaited<ReturnType<typeof listar>>) =>
    rows.map((r) => ({ id: r.id, phone: r.phone, reason: r.reason, createdAt: r.createdAt.toISOString() }))
  return <ListasClient black={fmt(black)} block={fmt(block)} />
}
