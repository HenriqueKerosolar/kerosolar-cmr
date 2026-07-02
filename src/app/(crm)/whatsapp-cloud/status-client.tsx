'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'

type Check = { ok: boolean; label: string; detail?: string }

type Template = {
  id: string
  name: string
  displayName: string
  category: string
  language: string
  bodyText: string
  metaStatus: string | null
  actionType: string | null
  lastSyncAt: string | null
}

function statusBadge(s: string | null) {
  const up = (s ?? '').toUpperCase()
  if (up === 'APPROVED') return { label: '✅ Aprovado',    cls: 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-400/10 dark:border-green-400/30' }
  if (up === 'PENDING')  return { label: '⏳ Em análise',  cls: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-400/10 dark:border-yellow-400/30' }
  if (up === 'REJECTED') return { label: '❌ Recusado',    cls: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-400/10 dark:border-red-400/30' }
  if (up === 'PAUSED')   return { label: '⏸ Pausado',     cls: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-400/10 dark:border-orange-400/30' }
  return { label: '— Desconhecido', cls: 'text-[--muted-foreground] bg-[--muted] border-[--border]' }
}

const ACTION_LABEL: Record<string, string> = {
  chegada_followup:    'Chegada (follow-up)',
  budget_followup:     'Follow-up orçamento',
  reengage:            'Reengajamento',
  lead_manual:         'Lead manual',
  retomada_chamada:    'Retomada pós-chamada',
  repescagem:          'Repescagem',
  '15dias':            '15 dias depois',
  '30dias':            '30 dias depois',
  '90dias':            '90 dias depois',
  '180dias':           '180 dias depois',
  enviar_conta:        'Ficou de enviar conta',
  orcamento_automatico:'Orçamento automático',
  orcamento_manual:    'Orçamento manual',
}

export function WhatsappCloudStatus({ templates: initial }: { templates: Template[] }) {
  const [checks, setChecks]       = useState<Check[] | null>(null)
  const [diagnosing, startDiag]   = useTransition()
  const [templates, setTemplates] = useState(initial)
  const [syncing, setSyncing]     = useState<string | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [lastDiag, setLastDiag]   = useState<string | null>(null)
  const [lastSync, setLastSync]   = useState<string | null>(null)
  const [expanded, setExpanded]   = useState<string | null>(null)

  const approvedCount = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'APPROVED').length
  const pendingCount  = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'PENDING').length
  const rejectedCount = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'REJECTED').length
  const pausedCount   = templates.filter(t => (t.metaStatus ?? '').toUpperCase() === 'PAUSED').length

  function runDiag() {
    setChecks(null)
    startDiag(async () => {
      const res = await fetch('/api/whatsapp-cloud/diagnose', { method: 'POST' })
      const data = await res.json() as { checks?: Check[] }
      setChecks(data.checks ?? [])
      setLastDiag(new Date().toLocaleTimeString('pt-BR'))
    })
  }

  const syncTemplate = useCallback(async (id: string) => {
    setSyncing(id)
    try {
      const res  = await fetch(`/api/templates/${id}/sync`, { method: 'POST' })
      const data = await res.json() as { metaStatus?: string }
      if (data.metaStatus) {
        setTemplates(prev => prev.map(t =>
          t.id === id ? { ...t, metaStatus: data.metaStatus ?? t.metaStatus, lastSyncAt: new Date().toISOString() } : t
        ))
      }
    } finally {
      setSyncing(null)
    }
  }, [])

  const syncAll = useCallback(async () => {
    setSyncingAll(true)
    for (const t of templates) {
      await syncTemplate(t.id)
    }
    setLastSync(new Date().toLocaleTimeString('pt-BR'))
    setSyncingAll(false)
  }, [templates, syncTemplate])

  // Auto-sync ao abrir a página
  useEffect(() => {
    runDiag()
    syncAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh a cada 30s enquanto tiver templates pendentes
  useEffect(() => {
    if (pendingCount === 0) return
    const id = setInterval(() => syncAll(), 30000)
    return () => clearInterval(id)
  }, [pendingCount, syncAll])

  const allOk   = checks !== null && checks.length > 0 && checks.every(c => c.ok)
  const someOk  = checks !== null && checks.some(c => c.ok)

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">API WhatsApp Cloud</h1>
        <p className="text-sm text-[--muted-foreground]">Diagnóstico e status da integração com a Meta.</p>
      </div>

      {/* Status card principal */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 transition-all ${
        diagnosing                    ? 'border-[--border] bg-[--card]'
        : allOk                       ? 'border-green-300 bg-green-50 dark:border-green-500/30 dark:bg-green-500/5'
        : someOk                      ? 'border-yellow-300 bg-yellow-50 dark:border-yellow-500/30 dark:bg-yellow-500/5'
        : checks !== null             ? 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/5'
        : 'border-[--border] bg-[--card]'
      }`}>
        <div className={`text-4xl ${diagnosing ? 'animate-pulse' : ''}`}>
          {diagnosing ? '⏳' : allOk ? '🟢' : someOk ? '🟡' : checks !== null ? '🔴' : '⚪'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base">
            {diagnosing ? 'Verificando conexão…'
              : allOk   ? 'API conectada e funcionando'
              : someOk  ? 'Conexão parcial — atenção necessária'
              : checks !== null ? 'API desconectada ou com erro'
              : 'Aguardando diagnóstico…'}
          </p>
          {lastDiag && !diagnosing && (
            <p className="text-xs text-[--muted-foreground] mt-0.5">Última verificação: {lastDiag}</p>
          )}
        </div>
        <button onClick={runDiag} disabled={diagnosing}
          className="shrink-0 text-sm px-4 py-2 rounded-xl border border-[--border] bg-[--background] hover:bg-[--accent] disabled:opacity-50 transition-colors">
          {diagnosing ? '…' : '🔄 Verificar'}
        </button>
      </div>

      {/* Checklist diagnóstico */}
      <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
        <div className="px-4 py-3 border-b border-[--border]">
          <p className="text-sm font-semibold">🩺 Diagnóstico da conexão</p>
        </div>
        <div className="divide-y divide-[--border]">
          {diagnosing && !checks && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[--muted] animate-pulse" />
              <div className="h-3 bg-[--muted] rounded animate-pulse flex-1 max-w-48" />
            </div>
          ))}
          {checks && checks.map((c, i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-3">
              <span className="text-base mt-0.5 shrink-0">{c.ok ? '✅' : '❌'}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.label}</p>
                {c.detail && <p className="text-xs text-[--muted-foreground] mt-0.5">{c.detail}</p>}
              </div>
            </div>
          ))}
          {!diagnosing && !checks && (
            <div className="px-4 py-6 text-center text-sm text-[--muted-foreground]">
              Clique em "Verificar" para checar a conexão.
            </div>
          )}
        </div>
      </div>

      {/* Resumo de templates */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Aprovados',   count: approvedCount, color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-400/10 border-green-200 dark:border-green-400/30' },
          { label: 'Em análise',  count: pendingCount,  color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-400/10 border-yellow-200 dark:border-yellow-400/30' },
          { label: 'Recusados',   count: rejectedCount, color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-400/10 border-red-200 dark:border-red-400/30' },
          { label: 'Pausados',    count: pausedCount,   color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-400/10 border-orange-200 dark:border-orange-400/30' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className={`rounded-xl border p-3 text-center ${bg}`}>
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className={`text-xs font-medium mt-0.5 ${color}`}>{label}</p>
          </div>
        ))}
      </div>

      {/* Aviso se tiver pendentes */}
      {pendingCount > 0 && (
        <div className="rounded-xl border border-yellow-200 dark:border-yellow-400/30 bg-yellow-50 dark:bg-yellow-400/10 px-4 py-3 flex items-start gap-2">
          <span className="text-base shrink-0">⏳</span>
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            <strong>{pendingCount} template{pendingCount !== 1 ? 's' : ''} aguardando aprovação da Meta.</strong>{' '}
            O status atualiza automaticamente a cada 30 segundos. Enquanto pendente, mensagens fora da janela de 24h não saem por esse template.
          </p>
        </div>
      )}

      {/* Lista de templates */}
      <div className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
        <div className="px-4 py-3 border-b border-[--border] flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold">📑 Templates de mensagem</p>
            {lastSync && (
              <p className="text-xs text-[--muted-foreground] mt-0.5">Sincronizado às {lastSync}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={syncAll} disabled={syncingAll || templates.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 disabled:opacity-50 transition-colors">
              {syncingAll ? '↻ Sincronizando…' : '↻ Sincronizar todos'}
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
              Criar templates →
            </a>
          </div>
        ) : (
          <div className="divide-y divide-[--border]">
            {templates.map((t) => {
              const badge  = statusBadge(t.metaStatus)
              const isOpen = expanded === t.id
              return (
                <div key={t.id}>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{t.displayName}</p>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {t.actionType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[--muted] text-[--muted-foreground] border border-[--border]">
                            🔗 {ACTION_LABEL[t.actionType] ?? t.actionType}
                          </span>
                        )}
                        <span className="text-[10px] text-[--muted-foreground]">{t.language} · {t.category}</span>
                        {t.lastSyncAt && (
                          <span className="text-[10px] text-[--muted-foreground]">
                            sync {new Date(t.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setExpanded(isOpen ? null : t.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-[--border] hover:bg-[--accent] transition-colors"
                        title="Ver texto">
                        {isOpen ? '▲' : '▼'}
                      </button>
                      <button onClick={() => syncTemplate(t.id)} disabled={syncing === t.id || syncingAll}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-[--border] hover:bg-[--accent] disabled:opacity-40 transition-colors"
                        title="Sincronizar status">
                        {syncing === t.id ? '…' : '↻'}
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3">
                      <div className="rounded-lg bg-[--muted] border border-[--border] px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-[--muted-foreground] mb-1.5 uppercase tracking-wide">Texto do template</p>
                        <p className="text-xs whitespace-pre-wrap text-[--foreground] font-mono leading-relaxed">{t.bodyText}</p>
                        <p className="text-[10px] text-[--muted-foreground] mt-2 font-mono">Nome Meta: {t.name}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Legenda */}
      <div className="rounded-xl border border-[--border] bg-[--card] px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide">Como funciona</p>
        <p className="text-xs text-[--muted-foreground]">
          Quando um lead não responde por mais de 24h, o WhatsApp bloqueia texto livre.
          O sistema envia automaticamente o template aprovado correspondente à etapa do funil.
        </p>
        <ul className="text-xs text-[--muted-foreground] space-y-0.5">
          <li>✅ <strong>Aprovado</strong> — pronto para envio automático fora da janela de 24h</li>
          <li>⏳ <strong>Em análise</strong> — aguardando a Meta aprovar (geralmente horas a 48h)</li>
          <li>❌ <strong>Recusado</strong> — revise o texto em Templates e reenvie para a Meta</li>
          <li>⏸ <strong>Pausado</strong> — a Meta pausou por alta taxa de denúncias</li>
        </ul>
      </div>
    </div>
  )
}
