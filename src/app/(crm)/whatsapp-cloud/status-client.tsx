'use client'

import { useState, useEffect, useTransition } from 'react'

type Check = { ok: boolean; label: string; detail?: string }

type Template = {
  id: string
  name: string
  displayName: string
  category: string
  language: string
  metaStatus: string | null
  actionType: string | null
  lastSyncAt: string | null
}

function statusBadge(s: string | null) {
  const up = (s ?? '').toUpperCase()
  if (up === 'APPROVED') return { label: '✅ Aprovado', cls: 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-400/10 dark:border-green-400/30' }
  if (up === 'PENDING')  return { label: '⏳ Em análise', cls: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-400/10 dark:border-yellow-400/30' }
  if (up === 'REJECTED') return { label: '❌ Recusado', cls: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-400/10 dark:border-red-400/30' }
  if (up === 'PAUSED')   return { label: '⏸ Pausado', cls: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-400/10 dark:border-orange-400/30' }
  return { label: '— Desconhecido', cls: 'text-[--muted-foreground] bg-[--muted] border-[--border]' }
}

export function WhatsappCloudStatus({ templates: initial }: { templates: Template[] }) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [diagnosing, startDiag] = useTransition()
  const [templates, setTemplates] = useState(initial)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncingAll, startSyncAll] = useTransition()
  const [lastDiag, setLastDiag] = useState<string | null>(null)

  // Auto-diagnose on mount
  useEffect(() => { runDiag() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function runDiag() {
    setChecks(null)
    startDiag(async () => {
      const res = await fetch('/api/whatsapp-cloud/diagnose', { method: 'POST' })
      const data = await res.json() as { checks?: Check[] }
      setChecks(data.checks ?? [])
      setLastDiag(new Date().toLocaleTimeString('pt-BR'))
    })
  }

  async function syncTemplate(id: string) {
    setSyncing(id)
    const res = await fetch(`/api/templates/${id}/sync`, { method: 'POST' })
    const data = await res.json() as { metaStatus?: string }
    if (data.metaStatus) {
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, metaStatus: data.metaStatus ?? t.metaStatus, lastSyncAt: new Date().toISOString() } : t))
    }
    setSyncing(null)
  }

  function syncAll() {
    startSyncAll(async () => {
      for (const t of templates) {
        await syncTemplate(t.id)
      }
    })
  }

  const allOk = checks !== null && checks.length > 0 && checks.every(c => c.ok)
  const someOk = checks !== null && checks.some(c => c.ok)
  const approvedCount = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'APPROVED').length
  const pendingCount = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'PENDING').length
  const rejectedCount = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'REJECTED').length

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">API WhatsApp Cloud</h1>
        <p className="text-sm text-[--muted-foreground]">Diagnóstico e status da integração com a Meta (WhatsApp Business Cloud API).</p>
      </div>

      {/* Status card principal */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 transition-all ${
        diagnosing ? 'border-[--border] bg-[--card]'
        : allOk ? 'border-green-300 bg-green-50 dark:border-green-500/30 dark:bg-green-500/5'
        : someOk ? 'border-yellow-300 bg-yellow-50 dark:border-yellow-500/30 dark:bg-yellow-500/5'
        : checks !== null ? 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/5'
        : 'border-[--border] bg-[--card]'
      }`}>
        <div className={`text-4xl ${diagnosing ? 'animate-pulse' : ''}`}>
          {diagnosing ? '⏳' : allOk ? '🟢' : someOk ? '🟡' : checks !== null ? '🔴' : '⚪'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base">
            {diagnosing ? 'Verificando conexão…'
              : allOk ? 'API conectada e funcionando'
              : someOk ? 'Conexão parcial — atenção necessária'
              : checks !== null ? 'API desconectada ou com erro'
              : 'Aguardando diagnóstico…'}
          </p>
          {lastDiag && !diagnosing && (
            <p className="text-xs text-[--muted-foreground] mt-0.5">Última verificação: {lastDiag}</p>
          )}
          {allOk && (
            <div className="flex gap-3 mt-2 flex-wrap">
              <span className="text-xs text-green-700 dark:text-green-400">✅ {approvedCount} template{approvedCount !== 1 ? 's' : ''} aprovado{approvedCount !== 1 ? 's' : ''}</span>
              {pendingCount > 0 && <span className="text-xs text-yellow-700 dark:text-yellow-400">⏳ {pendingCount} em análise</span>}
              {rejectedCount > 0 && <span className="text-xs text-red-700 dark:text-red-400">❌ {rejectedCount} recusado{rejectedCount !== 1 ? 's' : ''}</span>}
            </div>
          )}
        </div>
        <button onClick={runDiag} disabled={diagnosing}
          className="shrink-0 text-sm px-4 py-2 rounded-xl border border-[--border] bg-[--background] hover:bg-[--accent] disabled:opacity-50 transition-colors">
          {diagnosing ? '…' : '🔄 Verificar'}
        </button>
      </div>

      {/* Checklist diagnóstico */}
      <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
        <div className="px-4 py-3 border-b border-[--border] flex items-center justify-between">
          <p className="text-sm font-semibold">🩺 Diagnóstico da conexão</p>
          <button onClick={runDiag} disabled={diagnosing}
            className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 disabled:opacity-50 transition-colors">
            {diagnosing ? 'Consultando…' : '🩺 Diagnosticar token'}
          </button>
        </div>
        <div className="divide-y divide-[--border]">
          {diagnosing && !checks && (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-[--muted] animate-pulse" />
                <div className="h-3 bg-[--muted] rounded animate-pulse flex-1 max-w-48" />
              </div>
            ))
          )}
          {checks && checks.map((c, i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-3">
              <span className="text-base mt-0.5 shrink-0">{c.ok ? '✅' : '❌'}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.label}</p>
                {c.detail && (
                  <p className="text-xs text-[--muted-foreground] mt-0.5 truncate">{c.detail}</p>
                )}
              </div>
            </div>
          ))}
          {!diagnosing && !checks && (
            <div className="px-4 py-6 text-center text-sm text-[--muted-foreground]">
              Clique em "Diagnosticar token" para verificar a conexão.
            </div>
          )}
        </div>
      </div>

      {/* Templates */}
      <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
        <div className="px-4 py-3 border-b border-[--border] flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold">📑 Templates de mensagem</p>
            <p className="text-xs text-[--muted-foreground] mt-0.5">{templates.length} template{templates.length !== 1 ? 's' : ''} cadastrado{templates.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={syncAll} disabled={syncingAll || templates.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 disabled:opacity-50 transition-colors">
              {syncingAll ? 'Sincronizando…' : '↻ Sincronizar todos'}
            </button>
            <a href="/templates"
              className="text-xs px-3 py-1.5 rounded-lg bg-[--primary]/10 text-[--primary] border border-[--primary]/20 hover:bg-[--primary]/20 transition-colors">
              ✏️ Gerenciar
            </a>
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="px-4 py-8 text-center space-y-2">
            <p className="text-sm text-[--muted-foreground]">Nenhum template cadastrado ainda.</p>
            <a href="/templates" className="inline-block text-xs px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] font-medium">
              Ir para Templates →
            </a>
          </div>
        ) : (
          <div className="divide-y divide-[--border]">
            {templates.map((t) => {
              const badge = statusBadge(t.metaStatus)
              return (
                <div key={t.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{t.displayName}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-[--muted-foreground] mt-0.5 font-mono">{t.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {t.actionType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[--muted] text-[--muted-foreground] border border-[--border]">
                          {t.actionType}
                        </span>
                      )}
                      <span className="text-[10px] text-[--muted-foreground]">{t.language} · {t.category}</span>
                      {t.lastSyncAt && (
                        <span className="text-[10px] text-[--muted-foreground]">
                          sync {new Date(t.lastSyncAt).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => syncTemplate(t.id)} disabled={syncing === t.id || syncingAll}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-[--border] hover:bg-[--accent] disabled:opacity-40 transition-colors">
                    {syncing === t.id ? '…' : '↻'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Legenda */}
      <div className="rounded-xl border border-[--border] bg-[--card] px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide">Como funciona</p>
        <p className="text-xs text-[--muted-foreground]">
          Quando um lead não responde por mais de 24 horas, o WhatsApp bloqueia mensagens de texto livre.
          O sistema envia automaticamente o template aprovado correspondente ao estágio do funil.
        </p>
        <ul className="text-xs text-[--muted-foreground] space-y-0.5 pt-1">
          <li>✅ <strong>Aprovado</strong> — pronto para envio automático</li>
          <li>⏳ <strong>Em análise</strong> — aguardando aprovação da Meta (geralmente minutos a horas)</li>
          <li>❌ <strong>Recusado</strong> — revise o texto em Templates e reenvie</li>
        </ul>
      </div>
    </div>
  )
}
