'use client'

import { useState } from 'react'

type Stage = { id: string; name: string }

export function BroadcastButton({ stages }: { stages: Stage[] }) {
  const [open, setOpen] = useState(false)
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [text, setText] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  async function send() {
    if (!stageId || !text.trim()) return
    setSending(true); setResult('')
    const res = await fetch('/api/crm/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId, text, mediaUrl: mediaUrl || undefined, mediaType: mediaUrl ? 'image' : undefined }),
    })
    const data = await res.json()
    setSending(false)
    setResult(res.ok ? `✓ Agendado para ${data.agendados} lead(s) (de ${data.total})` : (data.error || 'Erro'))
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-sm border border-[--border] hover:bg-[--accent]">
        📣 Disparar
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-[--card] rounded-2xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg">📣 Disparo de mensagem</h2>
            <p className="text-xs text-[--muted-foreground]">Envia para todos os leads abertos da etapa, respeitando horário (dias úteis 9–18h, nada após 21h) e espaçando as mensagens (simula digitação). Pula quem pediu atendimento humano.</p>

            <div>
              <label className="block text-xs font-medium mb-1">Etapa</label>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm">
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Mensagem (use {'{nome}'} para o nome do cliente)</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                placeholder="Oi {nome}! Temos uma condição especial essa semana..."
                className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">(opcional) URL de imagem/vídeo/PDF</label>
              <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
            </div>

            {result && <p className="text-sm text-green-600">{result}</p>}

            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-[--muted-foreground]">Fechar</button>
              <button onClick={send} disabled={sending || !text.trim()}
                className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
                {sending ? 'Agendando…' : 'Disparar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
