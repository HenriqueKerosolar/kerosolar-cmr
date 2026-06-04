import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { getLiveStatus } from '@/lib/crm/whatsapp'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  const acc = await prisma.whatsappAccount.findUnique({ where: { id } })
  if (!acc) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  const live = getLiveStatus(id)
  return NextResponse.json({
    status: live?.status ?? acc.status,
    qr:     live?.qr ?? acc.qr,
    phone:  live?.phone ?? acc.phone,
  })
}
