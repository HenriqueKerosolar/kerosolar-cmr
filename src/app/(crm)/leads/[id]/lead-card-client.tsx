'use client'

import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { WhatsAppText } from '@/components/whatsapp-text'
import { useRouter } from 'next/navigation'
import {
  sendManualMessage, toggleLeadAi, moveLeadStage, updateLeadValue, addNote, addTask, completeTask, deleteLead, simulateClientMessage,
} from '@/app/actions/lead'

type Msg = { id: string; direction: string; senderType: string; content: string; mediaUrl: string | null; createdAt: string }

// Data e hora no horário de Brasília (DD/MM/AAAA HH:mm)
function horaBrasilia(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '' }
}
type Stage = { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean }
type Task = { id: string; title: string; status: string; dueAt: string | null }
type Note = { id: string; type: string; content: string; createdAt: string; author: { name: string } | null }
type ScheduledAction = { id: string; type: string; runAt: string }
type Lead = {
  id: string; title: string; value: number; status: string; aiEnabled: boolean; source: string | null
  customFields: Record<string, unknown> | null
  contact: { name: string | null; phone: string | null; email: string | null } | null
  stage: Stage
  pipeline: { name: string; icon: string | null; stages: Stage[] }
  tasks: Task[]; notes: Note[]; messages: Msg[]; scheduledActions: ScheduledAction[]
}

// Rótulos amigáveis para os tipos de ação automática agendada
const ACTION_LABELS: Record<string, string> = {
  send_message: '✉️ Mensagem programada',
  no_reply: '🔀 Mudança de etapa por inatividade',
  flow_noreply: '⏰ Cobrança de sem-resposta',
  flow_continue: '▶️ Continuação do fluxo',
  budget_followup: '💬 Follow-up do orçamento',
  budget_validity: '📅 Lembrete de validade do orçamento',
  reengage: '🔁 Reengajamento',
  chegada_followup: '👋 Lembrete de chegada',
  after_hours_resume: '🌅 Retomada do horário comercial (9h)',
  appointment_reminder: '📞 Lembrete de agendamento',
  ac_followup: '❄️ Follow-up de ar-condicionado',
  redeliver: '🔄 Reenvio de mensagem',
}
const actionLabel = (t: string) => ACTION_LABELS[t] ?? `⚙️ ${t}`

const fmtBRL = (n?: unknown) => typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
const channelIcon: Record<string, string> = { whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪', webchat: '🌐' }

export function LeadCardClient({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [messages, setMessages] = useState<Msg[]>(lead.messages)
  const [aiEnabled, setAiEnabled] = useState(lead.aiEnabled)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'chat' | 'timeline'>('chat')
  const [deleting, setDeleting] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Polling do chat
  const poll = useCallback(async () => {
    const res = await fetch(`/api/leads/${lead.id}/messages`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.messages)
    setAiEnabled(data.aiEnabled)
  }, [lead.id])

  useEffect(() => { const t = setInterval(poll, 4000); return () => clearInterval(t) }, [poll])
  // Auto-scroll só quando o usuário JÁ está perto do fim — se ele subiu para ler
  // mensagens antigas, o polling não arrasta a tela para baixo.
  const nearBottomRef = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  useEffect(() => {
    if (nearBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const run = (fn: () => Promise<unknown>) => startTransition(async () => { await fn(); router.refresh() })

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    const t = text; setText('')
    if (testMode) {
      // modo teste: simula mensagem do cliente → bot responde
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'inbound', senderType: 'contact', content: t, mediaUrl: null, createdAt: new Date().toISOString() }])
      try { await simulateClientMessage(lead.id, t); await poll() } finally { setSending(false) }
    } else {
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'outbound', senderType: 'human', content: t, mediaUrl: null, createdAt: new Date().toISOString() }])
      try { await sendManualMessage(lead.id, t); await poll() } finally { setSending(false) }
    }
  }

  async function uploadFile(file: File) {
    if (uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('caption', text.trim())   // texto do input vai como legenda
      const res = await fetch(`/api/leads/${lead.id}/send-media`, { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Falha ao enviar o arquivo.')
      } else {
        setText('')
        await poll()
      }
    } catch {
      alert('Falha ao enviar o arquivo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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
          {/* Botão IA — liga/desliga a IA neste lead, vale em qualquer etapa */}
          <button onClick={() => { setAiEnabled(!aiEnabled); run(() => toggleLeadAi(lead.id, !aiEnabled)) }}
            title={aiEnabled ? 'Clique para DESLIGAR a IA (você assume o atendimento)' : 'Clique para LIGAR a IA'}
            className={`ml-auto shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              aiEnabled
                ? 'bg-[--primary] text-[--primary-foreground] hover:opacity-90'
                : 'bg-amber-500 text-white hover:opacity-90'
            }`}>
            {aiEnabled ? '🤖 IA ativa · Desligar' : '👤 Manual · Ligar IA'}
          </button>
        </div>

        {!aiEnabled && (
          <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs text-center flex items-center justify-center gap-2 flex-wrap">
            <span>👤 Você assumiu — a IA está pausada neste lead.</span>
            <button onClick={() => { setAiEnabled(true); run(() => toggleLeadAi(lead.id, true)) }}
              className="px-2.5 py-1 rounded-md bg-[--primary] text-[--primary-foreground] font-medium hover:opacity-90 transition">
              🤖 Ligar IA de novo
            </button>
          </div>
        )}

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto p-4 space-y-3">
          {messages.map((m) => {
            if (m.senderType === 'system') return <div key={m.id} className="text-center"><span className="text-[11px] text-[--muted-foreground] bg-[--muted]/50 rounded-full px-2 py-0.5">{m.content} · {horaBrasilia(m.createdAt)}</span></div>
            const isIn = m.direction === 'inbound'
            return (
              <div key={m.id} className={`flex ${isIn ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${isIn ? 'bg-[--muted] rounded-bl-sm' : 'bg-[--primary] text-[--primary-foreground] rounded-br-sm'}`}>
                  {!isIn && <div className="text-[10px] opacity-70 mb-0.5">{m.senderType === 'ai' ? '🤖 IA' : m.senderType === 'human' ? '👤 Você' : 'Sistema'}</div>}
                  {m.mediaUrl && (
                    /\.(png|jpe?g|webp|gif)$/i.test(m.mediaUrl)
                      ? /* eslint-disable-next-line @next/next/no-img-element */
                        <a href={m.mediaUrl} target="_blank" rel="noreferrer"><img src={m.mediaUrl} alt="anexo" className="max-w-full rounded-lg mb-1 max-h-60 object-contain" /></a>
                      : <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs underline mb-1">📎 Abrir arquivo</a>
                  )}
                  <WhatsAppText text={m.content} />
                  <div className={`text-[10px] mt-1 ${isIn ? 'text-[--muted-foreground]' : 'opacity-70'} text-right`}>{horaBrasilia(m.createdAt)}</div>
                </div>
              </div>
            )
          })}
          {messages.length === 0 && <p className="text-center text-sm text-[--muted-foreground] mt-8">Nenhuma mensagem ainda.</p>}
        </div>

        <div className="border-t border-[--border] p-3 space-y-2">
          <div className="flex gap-2 items-center">
            {/* Anexar documento/imagem — só no envio real (não no modo teste) */}
            <input ref={fileRef} type="file" className="hidden"
              accept="image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f) }} />
            {!testMode && (
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                title="Anexar documento ou imagem"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-[--input] text-lg hover:bg-[--accent] disabled:opacity-50">
                {uploading ? '⏳' : '📎'}
              </button>
            )}
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={testMode ? '📱 Mensagem do cliente (teste do bot)…' : 'Escreva uma mensagem ou anexe um arquivo…'}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm outline-none ${testMode ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/20' : 'border-[--input] bg-[--background]'}`} />
            <button onClick={send} disabled={sending || !text.trim()}
              className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${testMode ? 'bg-violet-600 text-white' : 'bg-[--primary] text-[--primary-foreground]'}`}>
              {testMode ? '🧪' : 'Enviar'}
            </button>
          </div>
          <button onClick={() => setTestMode(!testMode)}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition ${testMode ? 'bg-violet-100 dark:bg-violet-950/30 border-violet-400 text-violet-700 dark:text-violet-300' : 'border-[--border] text-[--muted-foreground] hover:border-violet-400 hover:text-violet-600'}`}>
            {testMode ? '🧪 Modo teste ativo — enviando como cliente' : '🧪 Testar bot (simular cliente)'}
          </button>
        </div>
      </div>

      {/* ── Painel lateral do lead ── */}
      <div className="w-80 shrink-0 overflow-auto p-4 space-y-5 text-sm">
        <div>
          <p className="font-bold text-base">{lead.title}</p>
          <p className="text-xs text-[--muted-foreground]">{lead.pipeline.icon} {lead.pipeline.name}</p>
        </div>

        {/* Etapa — transferir o lead de etapa */}
        <div>
          <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Etapa (transferir)</label>
          <select value={lead.stage.id} onChange={(e) => run(() => moveLeadStage(lead.id, e.target.value))}
            className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm font-medium">
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
          {([['Conta de luz', fmtBRL(cf.billValue)], ['Consumo', cf.consumoKwh ? `${cf.consumoKwh} kWh` : '—'], ['Imóvel', (cf.propertyType as string) ?? '—'], ['Telhado', (cf.roofType as string) ?? '—'], ['Cidade', (cf.city as string) ?? '—']] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2"><span className="text-[--muted-foreground]">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </div>

        {/* ☀️ Simulação Solar */}
        {(() => {
          const s = cf.solar as Record<string, number> | undefined
          if (!s) return null
          return (
            <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200 dark:border-amber-900/40">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">☀️ Simulação Solar</p>
              {([['Sistema', fmtBRL(s.valorSistema)], ['Economia/mês', fmtBRL(s.economiaMensal)], ['Payback', `${s.paybackAnos} anos`], ['Economia 30 anos', fmtBRL(s.economia30Anos)], ['Menor parcela', fmtBRL(s.menorParcela)]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span className="text-[--muted-foreground]">{k}</span><span className="font-medium">{v}</span></div>
              ))}
            </div>
          )
        })()}

        {/* ⏰ Próxima atividade automática programada */}
        <div>
          <p className="text-xs font-medium text-[--muted-foreground] mb-1">Próxima atividade automática</p>
          {lead.scheduledActions.length === 0 ? (
            <p className="text-xs text-[--muted-foreground] italic">Nenhuma ação automática programada.</p>
          ) : (
            <div className="space-y-1">
              {lead.scheduledActions.map((a, i) => (
                <div key={a.id} className={`flex justify-between gap-2 text-xs ${i === 0 ? 'font-medium' : 'text-[--muted-foreground]'}`}>
                  <span>{actionLabel(a.type)}</span>
                  <span className="whitespace-nowrap">{horaBrasilia(a.runAt)}</span>
                </div>
              ))}
            </div>
          )}
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

        {/* Apagar lead */}
        <div className="pt-2 border-t border-[--border]">
          <button
            onClick={() => {
              if (deleting) return
              if (!confirm(`Apagar o lead "${lead.title}"? Isso remove a conversa, mensagens, tarefas e notas. Não dá pra desfazer.`)) return
              setDeleting(true)
              startTransition(async () => { await deleteLead(lead.id); router.push('/leads') })
            }}
            disabled={deleting}
            className="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-900/50 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
            {deleting ? 'Apagando…' : '🗑️ Apagar lead'}
          </button>
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
