'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PushSetup } from '@/components/push-setup'
import { InstallButton } from '@/components/install-button'

type Conv = { id: string; leadId: string | null; channel: string; name: string; lastText: string; lastAt: string | null; unread: boolean; stage: { name: string; color: string | null } | null }

const canalIcone: Record<string, string> = { whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪', webchat: '🌐' }

function quando(d: string | null): string {
  if (!d) return ''
  const date = new Date(d)
  const hoje = new Date()
  if (date.toDateString() === hoje.toDateString()) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function ConversasPage() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())

  async function carregar() {
    try {
      const r = await fetch('/api/app/conversations', { cache: 'no-store' })
      if (r.ok) { const d = await r.json(); setConvs(d.conversations || []) }
    } catch { /* ignora */ }
    setLoading(false)
  }

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 5000)
    return () => clearInterval(t)
  }, [])

  const termo = q.trim().toLowerCase()
  const lista = termo ? convs.filter((c) => c.name.toLowerCase().includes(termo) || c.lastText.toLowerCase().includes(termo)) : convs

  function toggleSeleção(convId: string) {
    setSelecionadas((prev) => {
      const nova = new Set(prev)
      nova.has(convId) ? nova.delete(convId) : nova.add(convId)
      return nova
    })
  }

  async function encerrarSelecionadas() {
    if (!selecionadas.size || !confirm(`Encerrar ${selecionadas.size} conversa(s)?\n\nElas saem da lista e a automação NÃO vai trazer de volta.`)) return
    try {
      await fetch('/api/app/conversations/batch-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ convIds: Array.from(selecionadas) }),
      })
      setSelecionadas(new Set())
      await carregar()
    } catch { alert('Erro ao encerrar conversas') }
  }

  return (
    <>
      {/* Cabeçalho */}
      <header className="shrink-0 bg-orange-500 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="KeroSolar" className="w-8 h-8 rounded-full bg-white object-contain" />
        {selecionadas.size > 0 ? (
          <>
            <span className="font-bold text-base flex-1">{selecionadas.size} selecionada(s)</span>
            <button onClick={encerrarSelecionadas} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition">🔒 Encerrar</button>
          </>
        ) : (
          <>
            <span className="font-bold text-base flex-1">KeroSolarZap</span>
            <InstallButton />
            <PushSetup />
          </>
        )}
      </header>

      {/* Busca */}
      <div className="shrink-0 p-2 bg-zinc-100 border-b border-zinc-200">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversa…"
          className="w-full px-4 py-2 rounded-full border border-zinc-300 bg-white text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-orange-300" />
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto bg-white divide-y divide-zinc-100">
        {lista.map((c) => (
          <div key={c.id} className={`flex items-center gap-2 px-4 py-3 transition ${selecionadas.has(c.id) ? 'bg-orange-50' : 'active:bg-zinc-100'}`}>
            <input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => toggleSeleção(c.id)}
              className="w-5 h-5 rounded border-zinc-300 text-orange-500 cursor-pointer shrink-0" />
            <Link href={`/app/c/${c.id}`} className="flex-1 flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg shrink-0">
                {c.name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate ${c.unread ? 'font-bold text-zinc-900' : 'font-medium text-zinc-800'}`}>
                    <span className="mr-1 text-xs">{canalIcone[c.channel] ?? '📱'}</span>{c.name}
                  </span>
                  <span className="text-[11px] text-zinc-400 shrink-0">{quando(c.lastAt)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className={`text-sm truncate flex-1 ${c.unread ? 'text-zinc-900 font-medium' : 'text-zinc-500'}`}>{c.lastText || '—'}</p>
                  {c.unread && <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />}
                </div>
                {c.stage && (
                  <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border"
                    style={{ borderColor: c.stage.color ?? '#cbd5e1', color: c.stage.color ?? '#64748b' }}>
                    {c.stage.name}
                  </span>
                )}
              </div>
            </Link>
          </div>
        ))}
        {!loading && lista.length === 0 && (
          <p className="text-center text-sm text-zinc-400 py-16">Nenhuma conversa{termo ? ' encontrada' : ''}.</p>
        )}
        {loading && <p className="text-center text-sm text-zinc-400 py-16">Carregando…</p>}
      </div>
    </>
  )
}
