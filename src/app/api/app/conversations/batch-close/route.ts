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
    // Mesmas regras do "Fechar" do Inbox do computador (encerrarConversa):
    // 1) marca resolvida  2) marca mensagens do cliente como lidas  3) pausa automações pendentes.
    const convs = await prisma.conversation.findMany({ where: { id: { in: convIds } }, select: { id: true, leadId: true } })
    await prisma.conversation.updateMany({ where: { id: { in: convIds } }, data: { resolvedAt: new Date() } })
    await prisma.message.updateMany({ where: { conversationId: { in: convIds }, direction: 'inbound', isRead: false }, data: { isRead: true } })
    const leadIds = convs.map((c) => c.leadId).filter((v): v is string => !!v)
    if (leadIds.length) {
      await prisma.scheduledAction.updateMany({ where: { leadId: { in: leadIds }, done: false }, data: { done: true } })
    }
    return NextResponse.json({ ok: true, count: convIds.length })
  } catch {
    return NextResponse.json({ error: 'Erro ao encerrar conversas.' }, { status: 500 })
  }
}
