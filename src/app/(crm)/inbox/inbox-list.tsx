'use client'

import { useState } from 'react'
import Link from 'next/link'
import { resolveConversation } from '@/app/actions/lead'

const channelIcon: Record<string, string> = {
  whatsapp: "🟢", instagram: "📷", facebook: "💬", simulator: "🧪", webchat: "🌐",
}

type Conv = {
  id: string
  channel: string
  leadId: string | null
  contact: { name: string | null; phone: string | null } | null
  lead: { highPriority: boolean; aiEnabled: boolean; humanOnly: boolean; createdAt: string; stage: { name: string; color: string | null } } | null
  messages: { direction: string; isRead: boolean; content: string; senderType: string }[]
  resolvedAt: string | null
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const digits = (s: string) => s.replace(/\D/g, '')

export function InboxList({ conversations, verTodas }: { conversations: Conv[]; verTodas: boolean }) {
  const [q, setQ] = useState('')

  const termo = norm(q)
  const termoNum = digits(q)

  const filtered = q
    ? conversations.filter((conv) => {
        const nome = norm(conv.contact?.name ?? '')
        const tel = conv.contact?.phone ?? ''
        return nome.includes(termo) || (termoNum.length > 0 && digits(tel).includes(termoNum))
      })
    : conversations

  return (
    <>
      {/* Campo de busca */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[--muted-foreground] text-sm">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
        />
        {q && (
          <button onClick={() => setQ('')} title="Limpar"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 text-[--muted-foreground] hover:text-[--foreground]">✕</button>
        )}
      </div>
      {q && <p className="text-xs text-[--muted-foreground] -mt-1">{filtered.length} resultado(s) para "{q}".</p>}

      <div className="space-y-2">
        {filtered.map((conv) => {
          const last = conv.messages[0]
          const unread = last && !last.isRead && last.direction === 'inbound'
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
        {filtered.length === 0 && (
          <div className="text-center py-16 text-[--muted-foreground] text-sm">
            {q
              ? <>Nenhuma conversa encontrada para "{q}".</>
              : verTodas
                ? <>Nenhuma conversa ainda.<br />Use o <Link href="/simulador" className="underline">Simulador</Link> para testar.</>
                : <>🎉 Tudo em dia! Nenhuma conversa precisa de você agora.<br />A IA está cuidando do resto. <Link href="/inbox?todas=1" className="underline">Ver todas</Link></>}
          </div>
        )}
      </div>
    </>
  )
}
