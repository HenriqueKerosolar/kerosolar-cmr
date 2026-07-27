import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { contarInbox } from '@/lib/crm/inbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Quantidade de conversas que precisam de atenção — usado no badge de novas entradas. */
export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ count: 0 }, { status: 401 })
  const count = await contarInbox()
  return NextResponse.json({ count })
}
