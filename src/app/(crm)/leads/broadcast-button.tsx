'use client'

import { useState } from 'react'

type Stage = { id: string; name: string }

export function BroadcastButton({ stages }: { stages: Stage[] }) {
  const [open, setOpen] = useState(false)
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [text, setText] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [minDays, setMinDays] = useState('')
  const [maxDays, setMaxDays] = useState('')
  const [order, setOrder] = useState<'oldest' | 'newest'>('oldest')
  const [limit, setLimit] = useState('')
  const [intervalMin, setIntervalMin] = useState('')
  const [vary, setVary] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  async function send() {
    if (!stageId || !text.trim()) return
    setSending(true); setResult('')
    const res = await fetch('/api/crm/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stageId, text,
        mediaUrl: mediaUrl || undefined, mediaType: mediaUrl ? 'image' : undefined,
        minDays: minDays ? Number(minDays) : undefined,
        maxDays: maxDays ? Number(maxDays) : undefined,
        order, vary,
        limit: limit ? Number(limit) : undefined,
        intervalMin: intervalMin ? Number(intervalMin) : undefined,
      }),
    })
    const data = await res.json()
    setSending(false)
    setResult(res.ok ? `✓ Agendado para ${data.agendados} lead(s) (de ${data.total} na lista)` : (data.error || 'Erro'))
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:border-[--primary]'

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-sm border border-[--border] hover:bg-[--accent]">
        📣 Disparar
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-[--card] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[--border] sticky top-0 bg-[--card] rounded-t-2xl">
              <h2 className="font-bold text-lg">📣 Lista de transmissão</h2>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg hover:bg-[--accent] text-[--muted-foreground] text-lg leading-none">×</button>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* PARA QUEM */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">👥 Para quem</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Etapa</label>
                  <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Na plataforma há (dias)</label>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" value={minDays} onChange={(e) => setMinDays(e.target.value)} placeholder="de" className={inputCls} />
                      <span className="text-[--muted-foreground]">–</span>
                      <input type="number" min="0" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="até" className={inputCls} />
                    </div>
                    <p className="text-[11px] text-[--muted-foreground] mt-1">Deixe vazio para todos.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Ordem</label>
                    <select value={order} onChange={(e) => setOrder(e.target.value as 'oldest' | 'newest')} className={inputCls}>
                      <option value="oldest">Mais antigos primeiro</option>
                      <option value="newest">Mais novos primeiro</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Limite de leads</label>
                    <input type="number" min="1" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="todos" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Intervalo entre envios (min)</label>
                    <input type="number" min="0" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} placeholder="automático" className={inputCls} />
                  </div>
                </div>
              </section>

              {/* MENSAGEM */}
              <section className="space-y-3 border-t border-[--border] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">💬 Mensagem</p>
                <div>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                    placeholder="Oi {nome}! Temos uma condição especial essa semana..."
                    className={inputCls} />
                  <p className="text-[11px] text-[--muted-foreground] mt-1">Use <b>{'{nome}'}</b> para o nome do cliente.</p>
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={vary} onChange={(e) => setVary(e.target.checked)} className="mt-0.5" />
                  <span>✨ <b>Variar a mensagem</b> — cada lead recebe uma versão diferente (a IA reescreve mantendo o sentido). Evita parecer disparo em massa.</span>
                </label>
                <div>
                  <label className="block text-sm font-medium mb-1">Imagem/vídeo/PDF <span className="text-[--muted-foreground] font-normal">(opcional, URL)</span></label>
                  <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} className={inputCls} />
                </div>
              </section>

              <p className="text-[11px] text-[--muted-foreground] bg-[--muted]/40 rounded-lg px-3 py-2">
                Os envios respeitam o horário comercial (dias úteis 9–18h) e são espaçados para parecer naturais. Quem pediu atendimento humano é pulado.
              </p>

              {result && <p className={`text-sm ${result.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{result}</p>}
            </div>

            {/* Rodapé */}
            <div className="flex gap-2 justify-end px-6 py-4 border-t border-[--border] sticky bottom-0 bg-[--card] rounded-b-2xl">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-[--border] hover:bg-[--accent]">Fechar</button>
              <button onClick={send} disabled={sending || !text.trim()}
                className="px-5 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
                {sending ? 'Agendando…' : '📣 Disparar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
