import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { disconnect } from '@/lib/crm/whatsapp'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  await disconnect(id)
  return NextResponse.json({ ok: true })
}
