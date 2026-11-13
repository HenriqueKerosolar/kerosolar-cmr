'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateLearnedAnswer, deleteLearnedAnswer, deleteLearnedAnswers, addLearnedAnswer } from '@/app/actions/learning'

type Item = { id: string; question: string; answer: string; useCount: number; createdAt: string; sugestaoApagar: string | null }

function dataBr(iso: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  } catch { return '' }
}

export function AprendizadoClient({ items }: { items: Item[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [novaQ, setNovaQ] = useState('')
  const [novaA, setNovaA] = useState('')
  const [busca, setBusca] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [soSugeridos, setSoSugeridos] = useState(false)

  const qtdSugeridos = items.filter((i) => i.sugestaoApagar).length
  const filtrados = items
    .filter((i) => !soSugeridos || i.sugestaoApagar)
    .filter((i) => !busca.trim() || (i.question + ' ' + i.answer).toLowerCase().includes(busca.toLowerCase()))

  function alternar(id: string) {
    setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function marcarTodosVisiveis(v: boolean) {
    setMarcados((s) => { const n = new Set(s); for (const i of filtrados) { if (v) n.add(i.id); else n.delete(i.id) } return n })
  }
  async function apagarMarcados() {
    if (busy || !marcados.size || !confirm(`Apagar ${marcados.size} aprendizado(s) marcado(s)? A IA não vai mais usar essas respostas.`)) return
    setBusy(true)
    try { await deleteLearnedAnswers([...marcados]); setMarcados(new Set()); router.refresh() } finally { setBusy(false) }
  }

  async function salvar(id: string) {
    if (!q.trim() || !a.trim() || busy) return
    setBusy(true)
    try { await updateLearnedAnswer(id, q, a); setEditId(null); router.refresh() } finally { setBusy(false) }
  }
  async function apagar(id: string) {
    if (busy || !confirm('Apagar este aprendizado? A IA não vai mais usar essa resposta.')) return
    setBusy(true)
    try { await deleteLearnedAnswer(id); router.refresh() } finally { setBusy(false) }
  }
  async function adicionar() {
    if (!novaQ.trim() || !novaA.trim() || busy) return
    setBusy(true)
    try { await addLearnedAnswer(novaQ, novaA); setNovaQ(''); setNovaA(''); router.refresh() } finally { setBusy(false) }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">🧠 Aprendizado da IA</h1>
        <p className="text-sm text-[--muted-foreground] mt-1">
          O que a IA aprendeu com as suas respostas. Ela usa isso como referência quando entra uma pergunta parecida.
          Você pode <b>editar</b>, <b>apagar</b> ou <b>adicionar</b> respostas aqui.
        </p>
      </div>

      {/* Adicionar manualmente */}
      <div className="rounded-xl border border-[--border] bg-[--card] p-3 space-y-2">
        <p className="text-sm font-medium">➕ Adicionar resposta manualmente</p>
        <input value={novaQ} onChange={(e) => setNovaQ(e.target.value)} placeholder="Pergunta do cliente (ex: qual a garantia dos painéis?)"
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm" />
        <textarea value={novaA} onChange={(e) => setNovaA(e.target.value)} placeholder="Resposta que a IA deve dar" rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm" />
        <button onClick={adicionar} disabled={busy || !novaQ.trim() || !novaA.trim()}
          className="text-sm px-3 py-1.5 rounded-lg bg-[--primary] text-[--primary-foreground] disabled:opacity-50">Adicionar</button>
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar nas respostas aprendidas…"
        className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm" />

      {/* Barra de seleção: marque o que deve sair e apague de uma vez */}
      <div className="sticky top-0 z-10 rounded-xl border border-[--border] bg-[--card] p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">☑️ {marcados.size} marcado(s)</span>
        <button onClick={() => marcarTodosVisiveis(true)} className="text-xs px-2.5 py-1 rounded-lg border border-[--border] hover:bg-[--accent]">Marcar todos da lista</button>
        <button onClick={() => marcarTodosVisiveis(false)} className="text-xs px-2.5 py-1 rounded-lg border border-[--border] hover:bg-[--accent]">Desmarcar da lista</button>
        {qtdSugeridos > 0 && (
          <label className="text-xs flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={soSugeridos} onChange={(e) => setSoSugeridos(e.target.checked)} />
            Mostrar só os que a IA sugere apagar ({qtdSugeridos})
          </label>
        )}
        <button onClick={apagarMarcados} disabled={busy || !marcados.size}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-40 ml-auto">🗑️ Apagar marcados</button>
      </div>

      <p className="text-xs text-[--muted-foreground]">{filtrados.length} de {items.length} aprendizado(s)</p>

      <div className="space-y-2">
        {filtrados.map((it) => (
          <div key={it.id} className={`rounded-xl border bg-[--card] p-3 flex gap-3 ${marcados.has(it.id) ? 'border-red-400' : 'border-[--border]'}`}>
            <input type="checkbox" checked={marcados.has(it.id)} onChange={() => alternar(it.id)}
              className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-red-600" aria-label="Marcar para apagar" />
            <div className="flex-1 min-w-0 space-y-2">
            {editId === it.id ? (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm" />
                <textarea value={a} onChange={(e) => setA(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm" />
                <div className="flex gap-2">
                  <button onClick={() => salvar(it.id)} disabled={busy}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[--primary] text-[--primary-foreground] disabled:opacity-50">Salvar</button>
                  <button onClick={() => setEditId(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[--border]">Cancelar</button>
                </div>
              </>
            ) : (
              <>
                {it.sugestaoApagar && (
                  <p className="text-[11px] inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800">⚠️ IA sugere apagar: {it.sugestaoApagar}</p>
                )}
                <p className="text-xs text-[--muted-foreground]">❓ Pergunta</p>
                <p className="text-sm font-medium">{it.question}</p>
                <p className="text-xs text-[--muted-foreground] mt-1">💬 Resposta da IA</p>
                <p className="text-sm whitespace-pre-wrap">{it.answer}</p>
                <div className="flex items-center gap-3 pt-1">
                  <button onClick={() => { setEditId(it.id); setQ(it.question); setA(it.answer) }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-[--border] hover:bg-[--accent]">✏️ Editar</button>
                  <button onClick={() => apagar(it.id)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-[--border] hover:border-red-400 hover:text-red-600">🗑️ Apagar</button>
                  <span className="text-[11px] text-[--muted-foreground] ml-auto">usada {it.useCount}x · {dataBr(it.createdAt)}</span>
                </div>
              </>
            )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-16 text-[--muted-foreground] text-sm">
            Ainda não há aprendizados.<br />Conforme você responde os clientes, a IA vai aprendendo e aparecendo aqui.
          </div>
        )}
      </div>
    </div>
  )
}
