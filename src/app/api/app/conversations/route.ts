import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { listarInbox } from '@/lib/crm/inbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lista de conversas pro app de atendimento (mobile) — MESMA regra do Inbox do desktop. */
export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const convs = await listarInbox()

  const list = convs.map((c) => {
    const last = c.messages[0]
    return {
      id: c.id,
      leadId: c.leadId,
      channel: c.channel,
      name: c.contact?.name || c.contact?.phone || 'Cliente',
      phone: c.contact?.phone || null,
      lastText: last ? (last.direction === 'outbound' ? (last.senderType === 'ai' ? '🤖 ' : '✓ ') : '') + (last.content || '') : '',
      lastAt: c.lastMessageAt,
      unread: (c._count?.messages ?? 0) > 0,   // qualquer mensagem do cliente ainda não vista
      stage: c.lead?.stage ? { name: c.lead.stage.name, color: c.lead.stage.color } : null,
    }
  })

  return NextResponse.json({ conversations: list })
}
