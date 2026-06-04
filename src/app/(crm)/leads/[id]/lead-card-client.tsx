'use client'

import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  sendManualMessage, toggleLeadAi, moveLeadStage, updateLeadValue, addNote, addTask, completeTask,
} from '@/app/actions/lead'

type Msg = { id: string; direction: string; senderType: string; content: string; mediaUrl: string | null; createdAt: string }
type Stage = { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean }
type Task = { id: string; title: string; status: string; dueAt: string | null }
type Note = { id: string; type: string; content: string; createdAt: string; author: { name: string } | null }
type Lead = {
  id: string; title: string; value: number; status: string; aiEnabled: boolean; source: string | null
  customFields: Record<string, unknown> | null
  contact: { name: string | null; phone: string | null; email: string | null } | null
  stage: Stage
  pipeline: { name: string; icon: string | null; stages: Stage[] }
  tasks: Task[]; notes: Note[]; messages: Msg[]
}

const fmtBRL = (n?: unknown) => typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
const channelIcon: Record<string, string> = { whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪' }

export function LeadCardClient({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [messages, setMessages] = useState<Msg[]>(lead.messages)
  const [aiEnabled, setAiEnabled] = useState(lead.aiEnabled)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'chat' | 'timeline'>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Polling do chat
  const poll = useCallback(async () => {
    const res = await fetch(`/api/leads/${lead.id}/messages`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.messages)
    setAiEnabled(data.aiEnabled)
  }, [lead.id])

  useEffect(() => { const t = setInterval(poll, 4000); return () => clearInterval(t) }, [poll])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages])

  const run = (fn: () => Promise<unknown>) => startTransition(async () => { await fn(); router.refresh() })

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    const t = text; setText('')
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'outbound', senderType: 'human', content: t, mediaUrl: null, createdAt: new Date().toISOString() }])
    try { await sendManualMessage(lead.id, t); await poll() } finally { setSending(false) }
  }

  const cf = lead.customFields ?? {}

  return (
    <div className="flex h-full">
      {/* ── Coluna do chat ── */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-[--border]">
        <div className="p-3 border-b border-[--border] flex items-center gap-2">
          <Link href="/leads" className="text-sm text-[--muted-foreground] hover:text-[--foreground]">← Voltar</Link>
          <span className="text-lg ml-1">{channelIcon[lead.source ?? ''] ?? '💬'}</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{lead.contact?.name ?? lead.title}</p>
            <p className="text-xs text-[--muted-foreground]">{lead.contact?.phone ?? '—'}</p>
          </div>
          {/* Toggle IA */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-[--muted-foreground]">IA</span>
            <button onClick={() => { setAiEnabled(!aiEnabled); run(() => toggleLeadAi(lead.id, !aiEnabled)) }}
              className={`relative w-11 h-6 rounded-full transition ${aiEnabled ? 'bg-[--primary]' : 'bg-[--muted]'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${aiEnabled ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        {!aiEnabled && <div className="px-4 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs text-center">👤 Você assumiu — a IA está pausada neste lead.</div>}

        <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
          {messages.map((m) => {
            if (m.senderType === 'system') return <div key={m.id} className="text-center"><span className="text-[11px] text-[--muted-foreground] bg-[--muted]/50 rounded-full px-2 py-0.5">{m.content}</span></div>
            const isIn = m.direction === 'inbound'
            return (
              <div key={m.id} className={`flex ${isIn ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${isIn ? 'bg-[--muted] rounded-bl-sm' : 'bg-[--primary] text-[--primary-foreground] rounded-br-sm'}`}>
                  {!isIn && <div className="text-[10px] opacity-70 mb-0.5">{m.senderType === 'ai' ? '🤖 IA' : m.senderType === 'human' ? '👤 Você' : 'Sistema'}</div>}
                  {m.mediaUrl && <div className="text-xs underline mb-1">📎 mídia</div>}
                  {m.content}
                </div>
              </div>
            )
          })}
          {messages.length === 0 && <p className="text-center text-sm text-[--muted-foreground] mt-8">Nenhuma mensagem ainda.</p>}
        </div>

        <div className="border-t border-[--border] p-3 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Escreva uma mensagem…" className="flex-1 px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
          <button onClick={send} disabled={sending || !text.trim()} className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">Enviar</button>
        </div>
      </div>

      {/* ── Painel lateral do lead ── */}
      <div className="w-80 shrink-0 overflow-auto p-4 space-y-5 text-sm">
        <div>
          <p className="font-bold text-base">{lead.title}</p>
          <p className="text-xs text-[--muted-foreground]">{lead.pipeline.icon} {lead.pipeline.name}</p>
        </div>

        {/* Etapa */}
        <div>
          <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Etapa</label>
          <select value={lead.stage.id} onChange={(e) => run(() => moveLeadStage(lead.id, e.target.value))}
            className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm">
            {lead.pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Valor */}
        <div>
          <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Valor estimado</label>
          <input type="number" defaultValue={lead.value} onBlur={(e) => run(() => updateLeadValue(lead.id, parseFloat(e.target.value) || 0))}
            className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm" />
        </div>

        {/* Contato */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-[--muted-foreground]">Contato</p>
          <p>{lead.contact?.name ?? '—'}</p>
          <p className="text-[--muted-foreground] text-xs">{lead.contact?.phone ?? '—'}</p>
          <p className="text-[--muted-foreground] text-xs">{lead.contact?.email ?? '—'}</p>
        </div>

        {/* Qualificação */}
        <div>
          <p className="text-xs font-medium text-[--muted-foreground] mb-1">Qualificação</p>
          {([['Conta de luz', fmtBRL(cf.billValue)], ['Imóvel', (cf.propertyType as string) ?? '—'], ['Telhado', (cf.roofType as string) ?? '—'], ['Cidade', (cf.city as string) ?? '—']] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><span className="text-[--muted-foreground]">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </div>

        {/* Tarefas */}
        <div>
          <p className="text-xs font-medium text-[--muted-foreground] mb-1">Tarefas</p>
          {lead.tasks.filter((t) => t.status === 'pending').map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-xs py-0.5">
              <input type="checkbox" onChange={() => run(() => completeTask(t.id))} /> {t.title}
            </label>
          ))}
          <AddTask leadId={lead.id} run={run} />
        </div>

        {/* Timeline / Notas */}
        <div>
          <p className="text-xs font-medium text-[--muted-foreground] mb-1">Timeline</p>
          <AddNote leadId={lead.id} run={run} />
          <div className="space-y-1.5 mt-2">
            {lead.notes.map((n) => (
              <div key={n.id} className="text-xs">
                <span className={n.type !== 'note' ? 'text-[--muted-foreground] italic' : ''}>
                  {n.type === 'stage_change' ? '🔀 ' : n.type === 'system' ? '⚙️ ' : '📝 '}{n.content}
                </span>
                {n.author && <span className="text-[--muted-foreground]"> — {n.author.name}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AddTask({ leadId, run }: { leadId: string; run: (fn: () => Promise<unknown>) => void }) {
  const [t, setT] = useState('')
  return (
    <div className="flex gap-1 mt-1">
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="+ tarefa" className="flex-1 px-2 py-1 rounded border border-[--input] bg-[--background] text-xs" />
      <button onClick={() => { if (t.trim()) { run(() => addTask(leadId, t)); setT('') } }} className="text-xs px-2 rounded bg-[--primary] text-[--primary-foreground]">ok</button>
    </div>
  )
}

function AddNote({ leadId, run }: { leadId: string; run: (fn: () => Promise<unknown>) => void }) {
  const [t, setT] = useState('')
  return (
    <div className="flex gap-1">
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="+ nota" className="flex-1 px-2 py-1 rounded border border-[--input] bg-[--background] text-xs" />
      <button onClick={() => { if (t.trim()) { run(() => addNote(leadId, t)); setT('') } }} className="text-xs px-2 rounded bg-[--primary] text-[--primary-foreground]">ok</button>
    </div>
  )
}
