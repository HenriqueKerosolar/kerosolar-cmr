import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id: leadId, msgId } = await params
  const { content } = await req.json() as { content?: string }

  if (!content?.trim()) return NextResponse.json({ error: 'Texto vazio.' }, { status: 400 })

  const msg = await prisma.message.findUnique({ where: { id: msgId }, include: { conversation: true } })
  if (!msg) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
  if (msg.conversation.leadId !== leadId) return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 })
  if (msg.direction !== 'outbound' || msg.senderType !== 'human') {
    return NextResponse.json({ error: 'Só pode editar mensagens que você enviou.' }, { status: 400 })
  }

  await prisma.message.update({ where: { id: msgId }, data: { content: content.trim() } })
  return NextResponse.json({ ok: true })
}
