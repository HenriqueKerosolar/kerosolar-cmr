import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from './session'

export const verifySession = cache(async () => {
  const session = await getSession()
  if (!session?.userId) redirect('/login')
  return session
})

export const verifyAdmin = cache(async () => {
  const session = await verifySession()
  if (session.role !== 'admin') redirect('/leads')
  return session
})

export async function getSessionSafe() {
  try { return await getSession() } catch { return null }
}
