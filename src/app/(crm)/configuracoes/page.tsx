import { verifyAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ConfigClient } from './config-client'
import { DEFAULT_VARIANTS, getVariantsRaw, placarSaudacoes } from '@/lib/crm/greeting'

export const dynamic = 'force-dynamic'

export default async function ConfigPage() {
  // systemConfig inclui as chaves de API da Anthropic/OpenAI (ver ALLOWED_KEYS
  // em /api/config) — leitura precisa do mesmo nível de acesso que a escrita.
  await verifyAdmin()
  const rows = await prisma.systemConfig.findMany()
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const variants = await getVariantsRaw()
  const placar = await placarSaudacoes()
  return <ConfigClient initial={cfg} variants={variants} defaults={DEFAULT_VARIANTS} placar={placar} />
}
