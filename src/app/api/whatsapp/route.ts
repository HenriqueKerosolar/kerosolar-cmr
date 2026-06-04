import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const accounts = await prisma.whatsappAccount.findMany({
    orderBy: { createdAt: 'asc' },
    include: { pipelines: { include: { pipeline: { select: { id: true, name: true, icon: true } } } } },
  })
  return NextResponse.json({ accounts })
}

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { label } = await req.json()
  if (!label?.trim()) return NextResponse.json({ error: 'Informe um nome para o número.' }, { status: 400 })
  const account = await prisma.whatsappAccount.create({ data: { label: label.trim() } })
  return NextResponse.json({ account })
}
