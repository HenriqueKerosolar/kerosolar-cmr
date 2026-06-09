'use client'

import { useState, useEffect, useCallback } from 'react'

type Pipe = { id: string; name: string; icon: string | null }
type Account = {
  id: string; label: string; phone: string | null; status: string
  pipelines: { pipeline: Pipe }[]
}

export function WhatsappClient() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/whatsapp')
    const data = await res.json()
    setAccounts(data.accounts ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Polling do QR / status enquanto o modal está aberto
  useEffect(() => {
    if (!qrFor) return
    let active = true
    const poll = async () => {
      const res = await fetch(`/api/whatsapp/${qrFor}/status`)
      const data = await res.json()
      if (!active) return
      setQr(data.qr)
      setQrStatus(data.status)
      if (data.status === 'connected') {
        setTimeout(() => { setQrFor(null); setQr(null); load() }, 1200)
      }
    }
    poll()
    const t = setInterval(poll, 2500)
    return () => { active = false; clearInterval(t) }
  }, [qrFor, load])

  async function addAccount() {
    if (!newLabel.trim()) return
    await fetch('/api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newLabel }) })
    setNewLabel('')
    load()
  }

  async function connect(id: string) {
    setQrFor(id); setQr(null); setQrStatus('connecting')
    await fetch(`/api/whatsapp/${id}/connect`, { method: 'POST' })
  }

  async function disconnect(id: string) {
    if (!confirm('Desconectar este número?')) return
    await fetch(`/api/whatsapp/${id}/disconnect`, { method: 'POST' })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Excluir este número do CRM?')) return
    await fetch(`/api/whatsapp/${id}`, { method: 'DELETE' })
    load()
  }

  const statusBadge = (s: string) => {
    const map: Record<string, [string, string]> = {
      connected:    ['🟢 Conectado', 'bg-green-500/10 text-green-700 border-green-500/30'],
      connecting:   ['🟡 Conectando…', 'bg-amber-500/10 text-amber-700 border-amber-500/30'],
      qr:           ['📲 Aguardando QR', 'bg-blue-500/10 text-blue-700 border-blue-500/30'],
      disconnected: ['⚪ Desconectado', 'bg-[--muted] text-[--muted-foreground] border-[--border]'],
    }
    const [label, cls] = map[s] ?? map.disconnected
    return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">WhatsApp</h1>
        <p className="text-sm text-[--muted-foreground]">Conecte um ou mais números lendo o QR Code (igual ao WhatsApp Web). Sem API.</p>
      </div>

      {/* Adicionar número */}
      <div className="flex gap-2">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAccount()}
          placeholder="Nome do número (ex: Vendas, Suporte)"
          className="flex-1 px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        <button onClick={addAccount} disabled={!newLabel.trim()}
          className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">+ Adicionar número</button>
      </div>

      {/* Lista */}
      {loading ? <p className="text-sm text-[--muted-foreground]">Carregando…</p> : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-4 rounded-xl border border-[--border] bg-[--card]">
              <span className="text-2xl">🟢</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{a.label}</p>
                  {statusBadge(a.status)}
                </div>
                <p className="text-xs text-[--muted-foreground]">{a.phone ? `+${a.phone}` : 'nenhum número conectado'}</p>
                {a.pipelines.length > 0 && (
                  <p className="text-[11px] text-[--muted-foreground] mt-0.5">Funis: {a.pipelines.map((p) => `${p.pipeline.icon ?? ''} ${p.pipeline.name}`).join(', ')}</p>
                )}
              </div>
              {a.status === 'connected' ? (
                <button onClick={() => disconnect(a.id)} className="text-xs px-3 py-1.5 rounded-lg border border-[--border] hover:bg-[--accent]">Desconectar</button>
              ) : (
                <button onClick={() => connect(a.id)} className="text-xs px-3 py-1.5 rounded-lg bg-[--primary] text-[--primary-foreground] font-medium">Conectar</button>
              )}
              <button onClick={() => remove(a.id)} className="text-xs text-[--destructive] px-2">🗑</button>
            </div>
          ))}
          {accounts.length === 0 && (
            <div className="p-6 rounded-xl border border-dashed border-[--border] text-center text-sm text-[--muted-foreground]">
              Nenhum número ainda. Adicione um acima e clique em Conectar.
            </div>
          )}
        </div>
      )}

      {/* Modal QR */}
      {qrFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setQrFor(null); load() }}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg">Conectar WhatsApp</h2>
            {qrStatus === 'connected' ? (
              <div className="py-8"><div className="text-5xl mb-2">✅</div><p className="font-medium">Conectado com sucesso!</p></div>
            ) : qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR Code" className="w-64 h-64 mx-auto rounded-lg border border-[--border]" />
                <ol className="text-xs text-[--muted-foreground] text-left space-y-1">
                  <li>1. Abra o WhatsApp no celular</li>
                  <li>2. Toque em <b>Mais opções ⋮ → Aparelhos conectados</b></li>
                  <li>3. Toque em <b>Conectar um aparelho</b></li>
                  <li>4. Aponte a câmera para este QR Code</li>
                </ol>
              </>
            ) : (
              <div className="py-12"><div className="animate-spin text-3xl">⏳</div><p className="text-sm text-[--muted-foreground] mt-2">Gerando QR Code…</p></div>
            )}
            <button onClick={() => { setQrFor(null); load() }} className="text-sm text-[--muted-foreground] hover:underline">Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}
