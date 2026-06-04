'use client'

import { useState, useEffect, useCallback } from 'react'

type Pipe = { id: string; name: string; icon: string | null }
type Conn = { channel: string; enabled: boolean; pageId: string; igId: string; hasToken: boolean; verifyToken: string; pipelineId: string }

export function MetaClient({ webhookUrl }: { webhookUrl: string }) {
  const [pipelines, setPipelines] = useState<Pipe[]>([])
  const [conns, setConns] = useState<Record<string, Conn>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/meta')
    const data = await res.json()
    setPipelines(data.pipelines ?? [])
    const map: Record<string, Conn> = {}
    for (const c of data.connections ?? []) map[c.channel] = c
    setConns(map)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-6 text-sm text-[--muted-foreground]">Carregando…</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Instagram & Facebook</h1>
        <p className="text-sm text-[--muted-foreground]">Conecte via API oficial da Meta. Você precisa de um App da Meta (modo desenvolvedor já funciona para suas próprias páginas).</p>
      </div>

      {/* Webhook info */}
      <div className="p-4 rounded-xl border border-[--border] bg-[--card] space-y-2">
        <p className="text-sm font-medium">🔗 Dados para configurar no App da Meta</p>
        <Field label="Callback URL (Webhook)" value={webhookUrl} />
        <p className="text-xs text-[--muted-foreground]">Cole essa URL no painel da Meta em <b>Webhooks → Callback URL</b>. Use o mesmo <b>Verify Token</b> que você definir abaixo. ⚠️ A URL precisa ser pública (não localhost) — funciona quando o app estiver publicado.</p>
      </div>

      <ChannelCard channel="facebook" label="Facebook (Messenger)" icon="💬" conn={conns.facebook} pipelines={pipelines} onSaved={load} />
      <ChannelCard channel="instagram" label="Instagram Direct" icon="📷" conn={conns.instagram} pipelines={pipelines} onSaved={load} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs text-[--muted-foreground] mb-0.5">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className="flex-1 px-2 py-1.5 rounded-lg border border-[--input] bg-[--muted]/40 text-xs font-mono" />
        <button onClick={() => navigator.clipboard.writeText(value)} className="text-xs px-2 rounded-lg border border-[--border] hover:bg-[--accent]">copiar</button>
      </div>
    </div>
  )
}

function ChannelCard({ channel, label, icon, conn, pipelines, onSaved }: {
  channel: 'facebook' | 'instagram'; label: string; icon: string
  conn?: Conn; pipelines: Pipe[]; onSaved: () => void
}) {
  const [pageId, setPageId] = useState(conn?.pageId ?? '')
  const [igId, setIgId] = useState(conn?.igId ?? '')
  const [token, setToken] = useState('')
  const [verifyToken, setVerifyToken] = useState(conn?.verifyToken || 'kerosolar-verify')
  const [pipelineId, setPipelineId] = useState(conn?.pipelineId ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    setSaving(true); setMsg('')
    const res = await fetch('/api/meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, pageId, igId, pageAccessToken: token, verifyToken, pipelineId }),
    })
    setSaving(false)
    if (res.ok) { setMsg('✓ Salvo!'); setToken(''); onSaved(); setTimeout(() => setMsg(''), 2000) }
    else setMsg('Erro ao salvar')
  }

  const connected = conn?.enabled && conn?.hasToken

  return (
    <div className="p-4 rounded-xl border border-[--border] bg-[--card] space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h2 className="font-semibold">{label}</h2>
        {connected
          ? <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full border bg-green-500/10 text-green-700 border-green-500/30">🟢 Conectado</span>
          : <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full border bg-[--muted] text-[--muted-foreground]">não conectado</span>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Page ID (ID da Página do Facebook)</label>
          <input value={pageId} onChange={(e) => setPageId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm" />
        </div>
        {channel === 'instagram' && (
          <div>
            <label className="block text-xs font-medium mb-1">Instagram Account ID</label>
            <input value={igId} onChange={(e) => setIgId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm" />
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Page Access Token {conn?.hasToken && <span className="text-[--muted-foreground]">(já salvo — preencha só para trocar)</span>}</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={conn?.hasToken ? '••••••••••••' : 'EAAG...'} className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm font-mono" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Verify Token (você escolhe)</label>
          <input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Funil de destino</label>
          <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-sm">
            <option value="">Funil padrão</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar conexão'}
        </button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </div>
  )
}
