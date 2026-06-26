import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { resolveConversation } from '@/app/actions/lead'
import { PushSetup } from '@/components/push-setup'

export const dynamic = 'force-dynamic'

const channelIcon: Record<string, string> = {
  whatsapp: "🟢", instagram: "📷", facebook: "💬", simulator: "🧪", webchat: "🌐",
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ todas?: string }> }) {
  await verifySession()
  const { todas } = await searchParams
  const verTodas = todas === '1'

  const all = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: {
      contact: true,
      lead: { include: { stage: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  // "Precisa de humano": cliente recusou bot, atendente assumiu, ou IA não resolveu.
  // Conversas FECHADAS pelo operador (resolvedAt) somem desta lista — voltam só quando
  // o cliente manda nova mensagem (a IA reabre zerando o resolvedAt).
  const needsHuman = (conv: (typeof all)[number]) =>
    !conv.resolvedAt && (
      conv.lead?.humanOnly === true ||
      conv.lead?.aiEnabled === false ||
      (conv.messages[0]?.direction === 'inbound' && !conv.messages[0]?.isRead)
    )

  const filtered = verTodas ? all : all.filter(needsHuman)
  // ⚡ Prioridade total no topo
  const conversations = filtered.sort((a, b) => Number(b.lead?.highPriority ?? false) - Number(a.lead?.highPriority ?? false))

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
        {verTodas ? `${conversations.length} conversas` : `${conversations.length} conversa(s) precisam de atendimento humano`}
      </p>

      <div className="space-y-2">
        {conversations.map((conv) => {
          const last = conv.messages[0]
          const unread = !last?.isRead && last?.direction === 'inbound'
          const isNew = conv.lead && (Date.now() - new Date(conv.lead.createdAt).getTime()) < 3 * 24 * 60 * 60 * 1000
          return (
            <div key={conv.id}
              className={`relative flex items-center gap-2 p-3 rounded-xl border bg-[--card] hover:shadow-sm transition ${unread ? 'ring-2 ring-[--ring]/40' : ''} ${isNew ? 'border-blue-400 dark:border-blue-500' : 'border-[--border]'}`}>
              <Link href={`/leads/${conv.leadId ?? ''}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[--primary]/20 text-[--primary] flex items-center justify-center font-bold text-sm shrink-0">
                  {conv.contact?.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {conv.lead?.highPriority && <span title="Prioridade total">⚡</span>}
                    <span className="font-medium text-sm truncate">{conv.contact?.name ?? conv.contact?.phone ?? 'Desconhecido'}</span>
                    <span className="text-xs">{channelIcon[conv.channel] ?? '📱'}</span>
                    {isNew && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 uppercase tracking-wide shrink-0">Novo</span>}
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
              <form action={resolveConversation.bind(null, conv.id)} className="shrink-0">
                <button type="submit" title="Fechar conversa (remove do Inbox)"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[--border] hover:bg-[--accent] hover:border-emerald-400 transition whitespace-nowrap">
                  ✓ Fechar
                </button>
              </form>
            </div>
          )
        })}
        {conversations.length === 0 && (
          <div className="text-center py-16 text-[--muted-foreground] text-sm">
            {verTodas
              ? <>Nenhuma conversa ainda.<br />Use o <Link href="/simulador" className="underline">Simulador</Link> para testar.</>
              : <>🎉 Tudo em dia! Nenhuma conversa precisa de você agora.<br />A IA está cuidando do resto. <Link href="/inbox?todas=1" className="underline">Ver todas</Link></>}
          </div>
        )}
      </div>
    </div>
  )
}
