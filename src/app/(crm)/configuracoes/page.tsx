import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ConfigClient } from './config-client'
import { DEFAULT_VARIANTS, getVariantsRaw, placarSaudacoes } from '@/lib/crm/greeting'

export const dynamic = 'force-dynamic'

export default async function ConfigPage() {
  await verifySession()
  const rows = await prisma.systemConfig.findMany()
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const variants = await getVariantsRaw()
  const placar = await placarSaudacoes()
  return <ConfigClient initial={cfg} variants={variants} defaults={DEFAULT_VARIANTS} placar={placar} />
}
