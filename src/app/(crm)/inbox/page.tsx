import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const channelIcon: Record<string, string> = {
  whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪',
}

export default async function InboxPage() {
  await verifySession()

  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    include: {
      contact: true,
      lead: { include: { stage: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold">Inbox</h1>
      <p className="text-sm text-[--muted-foreground]">{conversations.length} conversas</p>

      <div className="space-y-2">
        {conversations.map((conv) => {
          const last = conv.messages[0]
          const unread = !last?.isRead && last?.direction === 'inbound'
          return (
            <Link key={conv.id} href={`/leads/${conv.leadId ?? ''}`}
              className={`flex items-center gap-3 p-3 rounded-xl border border-[--border] bg-[--card] hover:shadow-sm transition ${unread ? 'ring-2 ring-[--ring]/40' : ''}`}>
              <div className="w-10 h-10 rounded-full bg-[--primary]/20 text-[--primary] flex items-center justify-center font-bold text-sm shrink-0">
                {conv.contact?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm truncate">{conv.contact?.name ?? conv.contact?.phone ?? 'Desconhecido'}</span>
                  <span className="text-xs">{channelIcon[conv.channel] ?? '📱'}</span>
                  {conv.lead && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-[--border] ml-auto shrink-0"
                      style={{ borderColor: conv.lead.stage.color ?? undefined }}>
                      {conv.lead.stage.name}
                    </span>
                  )}
                </div>
                {last && (
                  <p className={`text-xs truncate ${unread ? 'text-[--foreground] font-medium' : 'text-[--muted-foreground]'}`}>
                    {last.direction === 'outbound' ? (last.senderType === 'ai' ? '🤖 ' : '👤 ') : ''}{last.content}
                  </p>
                )}
              </div>
              {unread && <div className="w-2.5 h-2.5 rounded-full bg-[--primary] shrink-0" />}
            </Link>
          )
        })}
        {conversations.length === 0 && (
          <div className="text-center py-16 text-[--muted-foreground] text-sm">
            Nenhuma conversa ainda.<br />Use o <Link href="/simulador" className="underline">Simulador</Link> para testar.
          </div>
        )}
      </div>
    </div>
  )
}
