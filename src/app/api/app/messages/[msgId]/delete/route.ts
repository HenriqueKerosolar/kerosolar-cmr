import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ msgId: string }> },
) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { msgId } = await params

  const msg = await prisma.message.findUnique({ where: { id: msgId } })
  if (!msg) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
  if (msg.direction !== 'outbound' || msg.senderType !== 'human') {
    return NextResponse.json({ error: 'Só pode deletar mensagens que você enviou.' }, { status: 400 })
  }

  await prisma.message.delete({ where: { id: msgId } })
  return NextResponse.json({ ok: true })
}
