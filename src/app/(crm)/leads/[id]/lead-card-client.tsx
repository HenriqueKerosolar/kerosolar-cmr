'use client'

import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { WhatsAppText } from '@/components/whatsapp-text'
import { useRouter } from 'next/navigation'
import {
  sendManualMessage, toggleLeadAi, moveLeadStage, updateLeadValue, addNote, addTask, completeTask, deleteLead, simulateClientMessage,
} from '@/app/actions/lead'

type Msg = { id: string; direction: string; senderType: string; content: string; mediaUrl: string | null; mediaType: string | null; createdAt: string }

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
  const [improving, setImproving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [pastedFile, setPastedFile] = useState<File | null>(null)
  const [pastedPreview, setPastedPreview] = useState<string | null>(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplList, setTplList] = useState<{ id: string; displayName: string; bodyText: string; actionType: string | null }[]>([])
  const [tplSending, setTplSending] = useState<string | null>(null)
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

  async function deletarMensagem(msgId: string) {
    if (!confirm('Deletar esta mensagem?')) return
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages/${msgId}/delete`, { method: 'DELETE' })
      if (res.ok) {
        await poll()
      } else {
        alert('Erro ao deletar mensagem')
      }
    } catch {
      alert('Erro ao deletar mensagem')
    }
  }

  async function salvarEdicao(msgId: string) {
    if (!editText.trim()) return
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages/${msgId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText }),
      })
      if (res.ok) {
        setEditingId(null)
        setEditText('')
        await poll()
      } else {
        alert('Erro ao editar mensagem')
      }
    } catch {
      alert('Erro ao editar mensagem')
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const file = e.clipboardData.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    e.preventDefault()
    setPastedFile(file)
    const url = URL.createObjectURL(file)
    setPastedPreview(url)
  }

  function cancelPaste() {
    if (pastedPreview) URL.revokeObjectURL(pastedPreview)
    setPastedFile(null)
    setPastedPreview(null)
  }

  async function send() {
    if (pastedFile) {
      await uploadFile(pastedFile)
      cancelPaste()
      return
    }
    if (!text.trim() || sending) return
    setSending(true)
    const t = text; setText('')
    if (testMode) {
      // modo teste: simula mensagem do cliente → bot responde
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'inbound', senderType: 'contact', content: t, mediaUrl: null, mediaType: null, createdAt: new Date().toISOString() }])
      try { await simulateClientMessage(lead.id, t); await poll() } finally { setSending(false) }
    } else {
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'outbound', senderType: 'human', content: t, mediaUrl: null, mediaType: null, createdAt: new Date().toISOString() }])
      try { await sendManualMessage(lead.id, t); await poll() } finally { setSending(false) }
    }
  }

  async function abrirTemplates() {
    if (tplOpen) { setTplOpen(false); return }
    if (tplList.length === 0) {
      const res = await fetch('/api/templates')
      const data = await res.json() as { templates?: { id: string; displayName: string; bodyText: string; metaStatus: string | null; actionType: string | null }[] }
      setTplList((data.templates ?? []).filter(t => (t.metaStatus ?? '').toUpperCase() === 'APPROVED'))
    }
    setTplOpen(true)
  }

  async function enviarTemplate(tplId: string, bodyText: string) {
    setTplSending(tplId)
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tplId }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!data.ok) { alert(data.error ?? 'Erro ao enviar template'); return }
      setMessages(m => [...m, { id: `tmp-${Date.now()}`, direction: 'outbound', senderType: 'human', content: bodyText, mediaUrl: null, mediaType: null, createdAt: new Date().toISOString() }])
      setTplOpen(false)
      await poll()
    } finally { setTplSending(null) }
  }

  async function melhorarComIA() {
    if (!text.trim()) return
    setImproving(true)
    try {
      const res = await fetch('/api/ai/format-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (res.ok && data.formatted) {
        setText(data.formatted)
      }
    } catch { /* ignora */ } finally {
      setImproving(false)
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
            className={`ml-auto shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              aiEnabled
                ? 'bg-[--primary] text-[--primary-foreground] hover:opacity-90'
                : 'bg-amber-500 text-white hover:opacity-90'
            }`}>
            <span className="hidden sm:inline">{aiEnabled ? '🤖 IA ativa · Desligar' : '👤 Manual · Ligar IA'}</span>
            <span className="sm:hidden text-base leading-none">{aiEnabled ? '🤖' : '👤'}</span>
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
            const podeEditar = !isIn && m.senderType === 'human'
            const editando = editingId === m.id
            return (
              <div key={m.id} className={`flex ${isIn ? 'justify-start' : 'justify-end'} gap-1 group`}>
                {podeEditar && !editando && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => { setEditingId(m.id); setEditText(m.content) }}
                      className="px-2 py-1 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-950/30 rounded-lg text-xs"
                      title="Editar mensagem">
                      ✏️
                    </button>
                    <button onClick={() => deletarMensagem(m.id)}
                      className="px-2 py-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-950/30 rounded-lg text-xs"
                      title="Deletar mensagem">
                      🗑️
                    </button>
                  </div>
                )}
                {editando ? (
                  <div className="max-w-[75%] flex flex-col gap-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:border-[--primary]" />
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => { setEditingId(null); setEditText('') }}
                        className="px-3 py-1 rounded-lg text-xs border border-[--border] hover:bg-[--accent]">
                        Cancelar
                      </button>
                      <button onClick={() => salvarEdicao(m.id)}
                        className="px-3 py-1 rounded-lg text-xs bg-[--primary] text-[--primary-foreground] hover:opacity-90">
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${isIn ? 'bg-[--muted] rounded-bl-sm' : 'bg-[--primary] text-[--primary-foreground] rounded-br-sm'}`}>
                  {!isIn && <div className="text-[10px] opacity-70 mb-0.5">{m.senderType === 'ai' ? '🤖 IA' : m.senderType === 'human' ? '👤 Você' : 'Sistema'}</div>}
                  {m.mediaUrl && (() => {
                    const u = m.mediaUrl as string
                    const t = (m as any).mediaType || ''
                    if (t === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(u))
                      // eslint-disable-next-line @next/next/no-img-element
                      return <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="foto" className="max-w-full rounded-lg mb-1 max-h-60 object-contain" /></a>
                    if (t === 'audio' || /\.(ogg|mp3|m4a|aac|amr|wav)$/i.test(u))
                      return <audio controls src={u} className="mb-1 max-w-[220px]" />
                    if (t === 'video' || /\.(mp4|mov|3gp|webm)$/i.test(u))
                      return <video controls src={u} className="rounded-lg max-w-full mb-1 max-h-60" />
                    return <a href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs underline mb-1">📎 Abrir arquivo</a>
                  })()}
                  <WhatsAppText text={m.content} />
                  <div className={`text-[10px] mt-1 ${isIn ? 'text-[--muted-foreground]' : 'opacity-70'} text-right`}>{horaBrasilia(m.createdAt)}</div>
                </div>
                )}
              </div>
            )
          })}
          {messages.length === 0 && <p className="text-center text-sm text-[--muted-foreground] mt-8">Nenhuma mensagem ainda.</p>}
        </div>

        <div className="border-t border-[--border] p-3 space-y-2">
          {/* Painel de templates */}
          {tplOpen && (
            <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
              <div className="px-3 py-2 border-b border-[--border] flex items-center justify-between">
                <p className="text-xs font-semibold">📋 Escolha um template para enviar</p>
                <button onClick={() => setTplOpen(false)} className="text-xs text-[--muted-foreground] hover:text-[--foreground]">✕</button>
              </div>
              {tplList.length === 0 ? (
                <p className="px-3 py-4 text-xs text-[--muted-foreground] text-center">Nenhum template aprovado ainda. Aguarde a aprovação da Meta.</p>
              ) : (
                <div className="max-h-52 overflow-y-auto divide-y divide-[--border]">
                  {tplList.map(t => (
                    <button key={t.id} onClick={() => enviarTemplate(t.id, t.bodyText)} disabled={tplSending === t.id}
                      className="w-full text-left px-3 py-2.5 hover:bg-[--accent] transition-colors disabled:opacity-50">
                      <p className="text-xs font-semibold">{t.displayName}</p>
                      <p className="text-[11px] text-[--muted-foreground] mt-0.5 line-clamp-2">{t.bodyText.replace('{{1}}', lead.contact?.name?.split(' ')[0] ?? 'Cliente')}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
            {!testMode && (
              <button onClick={abrirTemplates} title="Enviar template aprovado"
                className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border text-lg hover:bg-[--accent] transition-colors ${tplOpen ? 'border-[--primary] bg-[--primary]/10' : 'border-[--input]'}`}>
                📋
              </button>
            )}
            <div className="flex-1 flex flex-col gap-1">
              {pastedPreview && (
                <div className="relative inline-block self-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pastedPreview} alt="preview" className="max-h-32 rounded-lg border border-[--border] object-contain" />
                  <button onClick={cancelPaste} title="Remover imagem"
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none">✕</button>
                </div>
              )}
              <input value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                onPaste={handlePaste}
                placeholder={pastedFile ? 'Legenda (opcional)…' : testMode ? '📱 Mensagem do cliente (teste do bot)…' : 'Escreva uma mensagem ou cole uma imagem (Ctrl+V)…'}
                className={`px-3 py-2 rounded-lg border text-sm outline-none ${testMode ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/20' : pastedFile ? 'border-blue-400 bg-[--background]' : 'border-[--input] bg-[--background]'}`} />
              {!testMode && (
                <button onClick={melhorarComIA} disabled={improving || !text.trim()}
                  className="text-left px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 font-medium self-start">
                  {improving ? '⏳ Melhorando...' : '✨ Melhorar ou Arrumar'}
                </button>
              )}
            </div>
            <button onClick={send} disabled={sending || uploading || (!text.trim() && !pastedFile)}
              className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${testMode ? 'bg-violet-600 text-white' : 'bg-[--primary] text-[--primary-foreground]'}`}>
              {testMode ? '🧪' : uploading ? '⏳' : 'Enviar'}
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
