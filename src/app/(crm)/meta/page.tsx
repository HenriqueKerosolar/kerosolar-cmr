import { verifySession } from '@/lib/dal'
import { MetaClient } from './meta-client'

export const dynamic = 'force-dynamic'

export default async function MetaPage() {
  await verifySession()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
  return <MetaClient webhookUrl={`${appUrl}/api/webhooks/meta`} />
}
