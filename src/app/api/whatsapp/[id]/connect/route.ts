import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { startSession } from '@/lib/crm/whatsapp'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  try {
    await startSession(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[wa connect]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao conectar.' }, { status: 500 })
  }
}
