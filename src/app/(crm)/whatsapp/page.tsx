import { verifySession } from '@/lib/dal'
import { WhatsappClient } from './whatsapp-client'

export const dynamic = 'force-dynamic'

export default async function WhatsappPage() {
  await verifySession()
  return <WhatsappClient />
}
