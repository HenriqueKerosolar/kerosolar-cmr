import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { disconnect } from '@/lib/crm/whatsapp'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  try { await disconnect(id) } catch {}
  await prisma.whatsappAccount.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
