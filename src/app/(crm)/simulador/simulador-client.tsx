'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { WhatsAppText } from '@/components/whatsapp-text'

type Msg = { id: string; direction: 'inbound' | 'outbound'; senderType: string; content: string }
type Lead = {
  id: string; title: string; value: number; status: string; aiEnabled: boolean
  customFields: Record<string, unknown> | null
  stage: { name: string; color: string | null }
  pipeline: { stages: { id: string; name: string; color: string | null }[] }
  contact: { name: string | null; phone: string | null } | null
  tasks: { id: string; title: string }[]
  notes: { id: string; content: string; type: string }[]
}

const SLOTS = [1, 2, 3, 4, 5]
const slotId = (n: number) => `sim-slot-${n}`
const slotName = (n: number) => `Cliente ${n}`

const EXAMPLES = [
  'Oi, vi um anúncio de vocês',
  'Quanto custa instalar painel solar?',
  'Minha conta de luz vem R$ 850 por mês',
  'Quero falar com um atendente',
]

const fmtBRL = (n?: unknown) =>
  typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'

export function SimuladorClient({ aiConfigured }: { aiConfigured: boolean }) {
  const [slot, setSlot] = useState(1)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  useEffect(() => {
    if (nearBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const loadSlot = useCallback(async (n: number) => {
    setSwitching(true)
    try {
      const res = await fetch(`/api/crm/simulate?externalId=${slotId(n)}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages ?? [])
        setLead(data.lead ?? null)
      }
    } catch { /* ignore */ } finally { setSwitching(false) }
  }, [])

  // Carrega slot 1 no mount
  useEffect(() => { loadSlot(1) }, [loadSlot])

  const isAudioFile = (f: File) =>
    f.type.startsWith('audio/') || /\.(ogg|mp3|m4a|wav|webm|aac)$/i.test(f.name)

  async function switchSlot(n: number) {
    if (n === slot || switching || loading) return
    setSlot(n)
    setImageFile(null); setImagePreview(null); setText('')
    await loadSlot(n)
  }

  async function send(override?: string) {
    const content = (override ?? text).trim()
    if (!content && !imageFile || loading) return
    setLoading(true); setText('')
    const isAudio = !!imageFile && isAudioFile(imageFile)
    const previewMsg = imageFile
      ? (isAudio ? '🎤 Áudio enviado' : (content || '📎 Conta de luz'))
      : content
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, direction: 'inbound', senderType: 'contact', content: previewMsg }])
    try {
      let res: Response
      if (imageFile) {
        const fd = new FormData()
        fd.append('channel', 'simulator')
        fd.append('externalId', slotId(slot))
        fd.append('name', slotName(slot))
        if (isAudio) {
          fd.append('audio', imageFile)
        } else {
          fd.append('text', content || 'Segue a foto da minha conta de luz.')
          fd.append('image', imageFile)
        }
        res = await fetch('/api/crm/simulate', { method: 'POST', body: fd })
        setImageFile(null); setImagePreview(null)
      } else {
        res = await fetch('/api/crm/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content, channel: 'simulator', externalId: slotId(slot), name: slotName(slot) }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessages(data.messages)
      setLead(data.lead)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro')
    } finally { setLoading(false) }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setImageFile(f)
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      setImagePreview('pdf')
    } else if (isAudioFile(f)) {
      setImagePreview('audio')
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => setImagePreview(ev.target?.result as string)
      reader.readAsDataURL(f)
    }
    e.target.value = ''
  }

  async function reset() {
    await fetch(`/api/crm/simulate?externalId=${slotId(slot)}`, { method: 'DELETE' })
    setMessages([]); setLead(null)
  }

  const cf = lead?.customFields ?? {}

  return (
    <div className="h-full flex flex-col p-4 md:p-6 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Simulador do Agente IA</h1>
          <p className="text-sm text-[--muted-foreground]">Converse como cliente · veja o lead sendo criado ao vivo</p>
        </div>
        <button onClick={reset} className="px-3 py-1.5 text-sm rounded-lg border border-[--border] hover:bg-[--accent] transition">
          🗑️ Resetar {slotName(slot)}
        </button>
      </div>

      {/* Seletor de clientes de teste */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[--muted-foreground] font-medium">Cliente de teste:</span>
        {SLOTS.map((n) => (
          <button
            key={n}
            onClick={() => switchSlot(n)}
            disabled={switching || loading}
            className={`px-3 py-1 text-sm rounded-full border transition font-medium disabled:opacity-60 ${
              slot === n
                ? 'bg-[--primary] text-[--primary-foreground] border-[--primary]'
                : 'border-[--border] hover:bg-[--accent]'
            }`}
          >
            Cliente {n}
          </button>
        ))}
        {switching && <span className="text-xs text-[--muted-foreground]">carregando…</span>}
      </div>

      {!aiConfigured && (
        <div className="px-4 py-3 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-700 dark:text-amber-300">
          ⚠️ Configure ANTHROPIC_API_KEY ou OPENAI_API_KEY no .env pra ativar a IA.
        </div>
      )}

      <div className="flex-1 grid gap-4 lg:grid-cols-[1fr_320px] min-h-0">
        {/* Chat */}
        <div className="flex flex-col border border-[--border] rounded-2xl overflow-hidden bg-[--card]">
          <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3" onScroll={() => { const el = scrollRef.current; if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}>
            {messages.length === 0 && !switching && (
              <div className="text-center text-sm text-[--muted-foreground] mt-10 space-y-3">
                <p>Envie uma mensagem como se fosse o cliente 👇</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} onClick={() => send(ex)}
                      className="text-xs px-3 py-1.5 rounded-full border border-[--border] bg-[--muted]/40 hover:bg-[--accent] transition">
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {switching && (
              <div className="text-center text-sm text-[--muted-foreground] mt-10">Carregando histórico…</div>
            )}
            {!switching && messages.map((m) => {
              if (m.senderType === 'system') return (
                <div key={m.id} className="text-center">
                  <span className="text-[11px] text-[--muted-foreground] bg-[--muted]/50 rounded-full px-2 py-0.5">{m.content}</span>
                </div>
              )
              const isIn = m.direction === 'inbound'
              return (
                <div key={m.id} className={`flex ${isIn ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${isIn ? 'bg-[--primary] text-[--primary-foreground] rounded-br-sm' : 'bg-[--muted] rounded-bl-sm'}`}>
                    {!isIn && <div className="text-[10px] font-medium opacity-60 mb-0.5">{m.senderType === 'ai' ? '🤖 Sol' : '👤 Atendente'}</div>}
                    <WhatsAppText text={m.content} />
                  </div>
                </div>
              )
            })}
            {loading && <div className="text-xs text-[--muted-foreground]">Sol está digitando…</div>}
          </div>
          <div className="border-t border-[--border] p-3 space-y-2">
            {imagePreview && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[--muted]/30 border border-[--border]">
                {imagePreview === 'pdf'
                  ? <span className="text-2xl">📄</span>
                  : imagePreview === 'audio'
                  ? <span className="text-2xl">🎤</span>
                  : <img src={imagePreview} alt="conta" className="h-12 w-auto rounded border border-[--border] object-cover" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{imageFile?.name}</p>
                  <p className="text-[11px] text-[--muted-foreground]">
                    {imagePreview === 'pdf'   ? '📊 IA vai extrair os dados da conta'
                   : imagePreview === 'audio' ? '🎙️ Whisper vai transcrever o áudio'
                   :                           '📷 IA vai ler a foto da conta'}
                  </p>
                </div>
                <button onClick={() => { setImageFile(null); setImagePreview(null) }} className="text-[--muted-foreground] hover:text-[--destructive] text-xl px-1">×</button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,audio/*,.ogg,.mp3,.m4a,.wav,.webm" className="hidden" onChange={onFileChange} />
              <button onClick={() => fileRef.current?.click()} disabled={loading}
                title="Enviar foto da conta de luz"
                className="px-3 py-2 rounded-lg border border-[--border] text-[--muted-foreground] hover:bg-[--accent] text-base disabled:opacity-50">
                📎
              </button>
              <input
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder={imageFile ? 'Mensagem opcional…' : 'Mensagem do cliente…'} disabled={loading || switching}
                className="flex-1 px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
              />
              <button onClick={() => send()} disabled={loading || switching || (!text.trim() && !imageFile)}
                className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50 transition hover:opacity-90">
                Enviar
              </button>
            </div>
          </div>
        </div>

        {/* Card do Lead */}
        <div className="border border-[--border] rounded-2xl bg-[--card] overflow-auto p-4 space-y-4 text-sm">
          <h2 className="font-semibold text-base">Card do Lead</h2>
          {!lead ? (
            <p className="text-[--muted-foreground]">Envie uma mensagem para criar o lead.</p>
          ) : (
            <>
              <div>
                <p className="font-semibold">{lead.title}</p>
                <p className="text-xs text-[--muted-foreground]">{lead.contact?.phone ?? '—'}</p>
              </div>

              {/* Funil */}
              <div>
                <p className="text-xs font-medium text-[--muted-foreground] mb-1.5">Etapa no funil</p>
                <div className="flex flex-wrap gap-1">
                  {lead.pipeline.stages.map((s) => {
                    const active = s.name === lead.stage.name
                    return (
                      <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full border"
                        style={active ? { background: s.color ?? '#888', color: '#fff', borderColor: s.color ?? '#888' } : {}}>
                        {s.name}
                      </span>
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full border">{lead.status}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${lead.aiEnabled ? 'bg-green-500/10 border-green-500/30 text-green-700' : 'bg-[--muted]'}`}>
                  IA {lead.aiEnabled ? 'ON' : 'OFF'}
                </span>
              </div>

              <div>
                <p className="text-xs text-[--muted-foreground]">Valor estimado</p>
                <p className="text-lg font-bold">{fmtBRL(lead.value)}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-[--muted-foreground] mb-1.5">Qualificação</p>
                <div className="space-y-1">
                  {([
                    ['Conta de luz', fmtBRL(cf.billValue)],
                    ['Imóvel',       (cf.propertyType as string) ?? '—'],
                    ['Telhado',      (cf.roofType as string) ?? '—'],
                    ['Cidade',       (cf.city as string) ?? '—'],
                    ['Decisor',      cf.isDecisionMaker == null ? '—' : cf.isDecisionMaker ? 'Sim' : 'Não'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-[--muted-foreground]">{k}</span>
                      <span className="font-medium text-right">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ☀️ Simulação Solar */}
              {(() => {
                const s = (lead.customFields as Record<string, unknown> | null)?.solar as Record<string, number> | undefined
                if (!s) return null
                return (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">☀️ Simulação Solar</p>
                    {([['Sistema', fmtBRL(s.valorSistema)], ['Economia/mês', fmtBRL(s.economiaMensal)], ['Payback', `${s.paybackAnos} anos`], ['Menor parcela', fmtBRL(s.menorParcela)]] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2"><span className="text-[--muted-foreground]">{k}</span><span className="font-medium text-right">{v}</span></div>
                    ))}
                  </div>
                )
              })()}

              {lead.tasks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[--muted-foreground] mb-1">Tarefas</p>
                  {lead.tasks.map((t) => (
                    <p key={t.id} className="text-xs flex gap-1.5">📌 {t.title}</p>
                  ))}
                </div>
              )}

              {lead.notes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[--muted-foreground] mb-1">Timeline</p>
                  {lead.notes.map((n) => (
                    <p key={n.id} className={`text-xs ${n.type === 'system' || n.type === 'stage_change' ? 'text-[--muted-foreground] italic' : ''}`}>
                      {n.type === 'stage_change' ? '🔀 ' : n.type === 'system' ? '🤖 ' : '📝 '}{n.content}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
