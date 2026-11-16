import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id: leadId, msgId } = await params

  const msg = await prisma.message.findUnique({ where: { id: msgId }, include: { conversation: true } })
  if (!msg) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
  if (msg.conversation.leadId !== leadId) return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 })
  // Regra do dono (16/11/2026): pode apagar QUALQUER mensagem enviada que esteja errada — sua ou da IA.
  // Apaga só do CRM: o WhatsApp não deixa a empresa apagar do celular do cliente.
  if (msg.direction !== 'outbound') {
    return NextResponse.json({ error: 'Só pode apagar mensagens enviadas pela KeroSolar.' }, { status: 400 })
  }

  await prisma.message.delete({ where: { id: msgId } })
  return NextResponse.json({ ok: true })
}
