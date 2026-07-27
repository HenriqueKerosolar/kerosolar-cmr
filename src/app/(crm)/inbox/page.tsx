import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { PushSetup } from '@/components/push-setup'
import { InboxList } from './inbox-list'
import { listarInbox } from '@/lib/crm/inbox'

export const dynamic = 'force-dynamic'

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ todas?: string }> }) {
  await verifySession()
  const { todas } = await searchParams
  const verTodas = todas === '1'

  // "Todas": mostra qualquer conversa com interação não encerrada. Padrão: a MESMA
  // regra do app do celular (listarInbox) — assim as duas telas são idênticas.
  const lista = verTodas
    ? await prisma.conversation.findMany({
        where: { resolvedAt: null, messages: { some: { direction: 'inbound' } } },
        orderBy: { lastMessageAt: 'asc' }, take: 300,
        include: { contact: true, lead: { include: { stage: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }).then((all) => all.sort((a, b) => Number(b.lead?.highPriority ?? false) - Number(a.lead?.highPriority ?? false)))
    : await listarInbox()

  const conversations = lista
    .map((conv) => ({
      id: conv.id,
      channel: conv.channel,
      leadId: conv.leadId,
      resolvedAt: conv.resolvedAt?.toISOString() ?? null,
      contact: conv.contact ? { name: conv.contact.name, phone: conv.contact.phone } : null,
      lead: conv.lead ? {
        highPriority: conv.lead.highPriority,
        aiEnabled: conv.lead.aiEnabled,
        humanOnly: conv.lead.humanOnly,
        createdAt: conv.lead.createdAt.toISOString(),
        stage: { name: conv.lead.stage.name, color: conv.lead.stage.color },
      } : null,
      messages: conv.messages.map((m) => ({
        direction: m.direction,
        isRead: m.isRead,
        content: m.content,
        senderType: m.senderType,
      })),
    }))

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold">Inbox</h1>
        <div className="flex items-center gap-1 text-sm">
          <PushSetup />
          <Link href="/inbox" className={`px-3 py-1 rounded-lg ${!verTodas ? 'bg-[--primary] text-[--primary-foreground]' : 'border border-[--border]'}`}>Precisam de mim</Link>
          <Link href="/inbox?todas=1" className={`px-3 py-1 rounded-lg ${verTodas ? 'bg-[--primary] text-[--primary-foreground]' : 'border border-[--border]'}`}>Todas</Link>
        </div>
      </div>
      <p className="text-sm text-[--muted-foreground]">
        {verTodas ? `${conversations.length} conversas`
          : `${conversations.length} conversa(s) precisam de você (atendente / cliente novo / não lidas)`}
      </p>
      <InboxList conversations={conversations} verTodas={verTodas} />
    </div>
  )
}
