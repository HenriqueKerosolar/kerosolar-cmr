'use client'
// ⚡ Respostas rápidas (pedido do dono, 23/11/2026): frases prontas escritas pelo atendente.
// Clique no ⚡ (ou digite "/" no campo) → escolhe a frase → ela vai para o campo de texto, onde dá
// para ajustar antes de enviar. Variáveis: {nome} = primeiro nome do cliente, {saudacao} = Bom dia/Boa tarde/Boa noite.
import { useEffect, useState } from 'react'

export type RespostaRapida = { id: string; titulo: string; texto: string }

function saudacao(): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'
}

export function preencher(texto: string, nomeCompleto?: string | null): string {
  const nome = (nomeCompleto ?? '').trim().split(/\s+/)[0]
  const nomeOk = nome && /[a-zà-ú]{2,}/i.test(nome) ? nome : ''
  return texto
    .replace(/\{saudacao\}/gi, saudacao())
    .replace(/,?\s*\{nome\}/gi, (m) => (nomeOk ? m.replace(/\{nome\}/i, nomeOk) : ''))
    .trim()
}

export function QuickReplies({ filtro, nomeCliente, onEscolher, onFechar }: {
  filtro: string
  nomeCliente?: string | null
  onEscolher: (texto: string) => void
  onFechar: () => void
}) {
  const [lista, setLista] = useState<RespostaRapida[] | null>(null)
  const [editando, setEditando] = useState<RespostaRapida | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetch('/api/quick-replies').then((r) => r.json()).then((j) => setLista(j.respostas ?? [])).catch(() => setLista([]))
  }, [])

  async function salvar(nova: RespostaRapida[]) {
    setSalvando(true); setErro('')
    try {
      const r = await fetch('/api/quick-replies', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ respostas: nova }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'erro')
      setLista(j.respostas); setEditando(null)
    } catch { setErro('Não consegui salvar. Tente de novo.') }
    setSalvando(false)
  }

  const f = filtro.trim().toLowerCase()
  const visiveis = (lista ?? []).filter((q) => !f || q.titulo.toLowerCase().includes(f) || q.texto.toLowerCase().includes(f))

  return (
    <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
      <div className="px-3 py-2 border-b border-[--border] flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">⚡ Respostas rápidas</p>
        <div className="flex items-center gap-3">
          {!editando && (
            <button onClick={() => setEditando({ id: '', titulo: '', texto: '' })} className="text-xs text-[--primary] font-medium hover:underline">+ Nova frase</button>
          )}
          <button onClick={onFechar} className="text-xs text-[--muted-foreground] hover:text-[--foreground]">✕</button>
        </div>
      </div>

      {editando ? (
        <div className="p-3 space-y-2">
          <input value={editando.titulo} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })}
            placeholder="Nome curto (ex.: Apresentação, Pedir conta, Taxa mínima)"
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:border-[--primary]" />
          <textarea value={editando.texto} onChange={(e) => setEditando({ ...editando, texto: e.target.value })} rows={5}
            placeholder="Texto da frase. Pode usar {saudacao} e {nome}. Ex.: {saudacao}, {nome}! Henrique falando, serei seu consultor."
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:border-[--primary] resize-y" />
          <p className="text-[11px] text-[--muted-foreground]">{'{saudacao}'} vira Bom dia/Boa tarde/Boa noite · {'{nome}'} vira o primeiro nome do cliente</p>
          {erro && <p className="text-xs text-red-500">{erro}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setEditando(null); setErro('') }} className="px-3 py-1.5 rounded-lg text-xs border border-[--input] hover:bg-[--accent]">Cancelar</button>
            <button disabled={salvando || !editando.texto.trim()}
              onClick={() => {
                const atual = lista ?? []
                const item = { ...editando, id: editando.id || `qr${Date.now()}` }
                salvar(editando.id ? atual.map((q) => (q.id === editando.id ? item : q)) : [...atual, item])
              }}
              className="px-3 py-1.5 rounded-lg text-xs bg-[--primary] text-[--primary-foreground] font-medium disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : lista === null ? (
        <p className="px-3 py-4 text-xs text-[--muted-foreground] text-center">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="px-3 py-4 text-xs text-[--muted-foreground] text-center">
          {lista.length === 0 ? 'Nenhuma frase ainda. Clique em "+ Nova frase" para criar a primeira.' : 'Nenhuma frase com esse nome.'}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-[--border]">
          {visiveis.map((q) => (
            <div key={q.id} className="flex items-start gap-1 hover:bg-[--accent] transition-colors">
              <button onClick={() => onEscolher(preencher(q.texto, nomeCliente))} className="flex-1 min-w-0 text-left px-3 py-2.5">
                <p className="text-xs font-semibold">{q.titulo}</p>
                <p className="text-[11px] text-[--muted-foreground] mt-0.5 line-clamp-2 whitespace-pre-line">{preencher(q.texto, nomeCliente)}</p>
              </button>
              <button title="Editar" onClick={() => setEditando(q)} className="shrink-0 px-2 py-2.5 text-xs opacity-60 hover:opacity-100">✏️</button>
              <button title="Apagar" disabled={salvando}
                onClick={() => { if (confirm(`Apagar a frase "${q.titulo}"?`)) salvar((lista ?? []).filter((x) => x.id !== q.id)) }}
                className="shrink-0 px-2 py-2.5 text-xs opacity-60 hover:opacity-100">🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
