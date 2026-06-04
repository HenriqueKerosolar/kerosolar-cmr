import { verifySession } from '@/lib/dal'
import { ensureDefaultPipeline } from '@/lib/crm/engine'
import { loadAiConfig } from '@/lib/crm/ai'
import { SimuladorClient } from './simulador-client'

export const dynamic = 'force-dynamic'

export default async function SimuladorPage() {
  await verifySession()
  await ensureDefaultPipeline()
  const cfg = await loadAiConfig()
  return <SimuladorClient aiConfigured={cfg.provider !== null} />
}
