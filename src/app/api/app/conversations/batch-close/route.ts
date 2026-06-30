import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { convIds } = await req.json() as { convIds?: string[] }
  if (!Array.isArray(convIds) || convIds.length === 0) {
    return NextResponse.json({ error: 'IDs de conversas inválidos.' }, { status: 400 })
  }

  try {
    await prisma.conversation.updateMany({
      where: { id: { in: convIds } },
      data: { resolvedAt: new Date() },
    })
    return NextResponse.json({ ok: true, count: convIds.length })
  } catch {
    return NextResponse.json({ error: 'Erro ao encerrar conversas.' }, { status: 500 })
  }
}
