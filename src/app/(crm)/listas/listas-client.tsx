'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addToList, removeFromList } from '@/app/actions/lists'

type Item = { id: string; phone: string; reason: string | null; createdAt: string }
type Kind = 'no_send' | 'no_receive'

function dataBr(iso: string) {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) } catch { return '' }
}

function Lista({ kind, titulo, desc, cor, items }: { kind: Kind; titulo: string; desc: string; cor: string; items: Item[] }) {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!phone.trim() || busy) return
    setBusy(true)
    try { await addToList(phone, kind, reason); setPhone(''); setReason(''); router.refresh() } finally { setBusy(false) }
  }
  async function rem(p: string) {
    if (busy || !confirm(`Remover ${p} desta lista?`)) return
    setBusy(true)
    try { await removeFromList(p, kind); router.refresh() } finally { setBusy(false) }
  }

  const inputCls = 'px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none'
  return (
    <div className="rounded-2xl border border-[--border] bg-[--card] p-4 space-y-3">
      <div>
        <h2 className={`font-bold ${cor}`}>{titulo}</h2>
        <p className="text-xs text-[--muted-foreground] mt-0.5">{desc}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Número (ex: 21998887777)" className={`${inputCls} flex-1 min-w-[160px]`} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={`${inputCls} flex-1 min-w-[140px]`} />
        <button onClick={add} disabled={busy || !phone.trim()} className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">Adicionar</button>
      </div>
      <div className="divide-y divide-[--border]">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <span className="font-medium">{it.phone}</span>
              {it.reason && <span className="text-[--muted-foreground]"> · {it.reason}</span>}
              <span className="text-[11px] text-[--muted-foreground]"> · {dataBr(it.createdAt)}</span>
            </div>
            <button onClick={() => rem(it.phone)} className="text-xs px-2 py-1 rounded-lg border border-[--border] hover:border-red-400 hover:text-red-600">remover</button>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-[--muted-foreground] py-3">Nenhum número aqui.</p>}
      </div>
    </div>
  )
}

export function ListasClient({ black, block }: { black: Item[]; block: Item[] }) {
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">🚫 Listas de bloqueio</h1>
        <p className="text-sm text-[--muted-foreground] mt-1">Controle quem NÃO deve receber mensagens e quem deve ser ignorado.</p>
      </div>
      <Lista kind="no_send" titulo="⛔ Black list — não enviar" cor="text-red-600"
        desc="Esses números NUNCA recebem mensagens nossas (nem disparo, nem automação, nem IA). Quem reclama do disparo entra aqui sozinho."
        items={black} />
      <Lista kind="no_receive" titulo="🔇 Block list — não receber" cor="text-orange-600"
        desc="Mensagens que esses números enviarem são IGNORADAS (a IA não lê nem responde)."
        items={block} />
    </div>
  )
}
