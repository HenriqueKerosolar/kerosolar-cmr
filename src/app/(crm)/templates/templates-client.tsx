'use client'

import { useState, useEffect } from 'react'

type TokenStatus = {
  ok: boolean
  error?: string
  userId?: string
  userName?: string
  wabaId?: string
  wabaName?: string
  phoneId?: string
  phoneName?: string
  accountLabel?: string
}

type Template = {
  id: string
  name: string
  displayName: string
  category: string
  language: string
  bodyText: string
  variables: unknown
  actionType: string | null
  metaStatus: string | null
  lastSyncAt: string | null
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  chegada_followup: 'Follow-up de Chegada',
  reengage: 'Reengajamento',
  budget_followup: 'Follow-up de Orçamento',
  budget_validity: 'Validade do Orçamento',
  after_hours_resume: 'Retomada Fora do Horário',
}

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-green-500/15 text-green-400 border border-green-500/30',
  PENDING: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  REJECTED: 'bg-red-500/15 text-red-400 border border-red-500/30',
  PAUSED: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  PENDENTE_ENVIO: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  NAO_ENVIADO: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30',
}

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  PENDENTE_ENVIO: 'Aguardando envio',
  NAO_ENVIADO: 'Não enviado',
}

const EMPTY_FORM = {
  name: '',
  displayName: '',
  category: 'MARKETING',
  language: 'pt_BR',
  bodyText: '',
  variables: [] as { index: number; description: string }[],
  actionType: '',
}

export function TemplatesClient({ initial }: { initial: Template[] }) {
  const [templates, setTemplates] = useState<Template[]>(initial)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [aiContext, setAiContext] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Token test state
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)
  const [testingToken, setTestingToken] = useState(false)

  useEffect(() => { testarToken() }, []) // testa ao carregar a página

  async function testarToken() {
    setTestingToken(true)
    try {
      const res = await fetch('/api/templates/test-token', { method: 'POST' })
      const data = await res.json() as TokenStatus
      setTokenStatus(data)
    } catch {
      setTokenStatus({ ok: false, error: 'Erro de conexão' })
    } finally {
      setTestingToken(false)
    }
  }
  const [aiExplanation, setAiExplanation] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function gerarComIA() {
    if (!aiContext.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: aiContext, actionType: form.actionType || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar')
      const t = data.template
      setForm((f) => ({
        ...f,
        name: t.name || f.name,
        displayName: t.displayName || f.displayName,
        bodyText: t.bodyText || f.bodyText,
        variables: t.variables || [],
      }))
      setAiExplanation(t.explanation || '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro')
    } finally {
      setAiLoading(false)
    }
  }

  async function salvar() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          variables: form.variables,
          actionType: form.actionType || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      setTemplates((prev) => [data.template, ...prev])
      setShowModal(false)
      setForm(EMPTY_FORM)
      setAiContext('')
      setAiExplanation('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function sincronizar(t: Template) {
    setSyncingId(t.id)
    try {
      const res = await fetch(`/api/templates/${t.id}/sync`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao sincronizar')
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...data.template } : x)))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erro ao sincronizar')
    } finally {
      setSyncingId(null)
    }
  }

  async function excluir(t: Template) {
    if (!confirm(`Excluir o template "${t.displayName}"?`)) return
    setDeletingId(t.id)
    try {
      await fetch(`/api/templates/${t.id}`, { method: 'DELETE' })
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
    } finally {
      setDeletingId(null)
    }
  }

  const previewBody = (t: Template) => {
    const vars = (t.variables as { index: number; description: string }[] | null) || []
    let text = t.bodyText
    vars.forEach((v) => {
      text = text.replace(`{{${v.index}}}`, `[${v.description}]`)
    })
    return text
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Templates WhatsApp</h1>
          <p className="text-sm text-[--muted-foreground] mt-0.5">
            Mensagens aprovadas pela Meta para reengajamento fora da janela de 24h
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); setForm(EMPTY_FORM); setAiContext(''); setAiExplanation(''); setError('') }}
          className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-semibold hover:opacity-90 transition"
        >
          + Novo template
        </button>
      </div>

      {/* Painel de status do token Meta */}
      <div className="rounded-xl border border-[--border] bg-[--card] p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl shrink-0">🔑</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Token Meta Cloud API</p>
              {testingToken ? (
                <p className="text-xs text-[--muted-foreground]">Verificando…</p>
              ) : tokenStatus?.ok ? (
                <p className="text-xs text-[--muted-foreground] truncate">
                  {tokenStatus.wabaName && <span>{tokenStatus.wabaName}</span>}
                  {tokenStatus.phoneName && <span> · 📱 {tokenStatus.phoneName}</span>}
                  {tokenStatus.userName && <span> · 👤 {tokenStatus.userName}</span>}
                </p>
              ) : (
                <p className="text-xs text-red-400 truncate">{tokenStatus?.error ?? 'Não testado'}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!testingToken && tokenStatus && (
              tokenStatus.ok
                ? <span className="text-[11px] px-2 py-0.5 rounded-full border bg-green-500/10 text-green-400 border-green-500/30">🟢 Conectado</span>
                : <span className="text-[11px] px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/30">🔴 Erro</span>
            )}
            {testingToken && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/30">🟡 Testando…</span>
            )}
            <button
              onClick={testarToken}
              disabled={testingToken}
              className="px-3 py-1.5 rounded-lg border border-[--border] text-xs text-[--muted-foreground] hover:text-[--foreground] hover:border-[--foreground]/30 transition disabled:opacity-50"
            >
              {testingToken ? 'Testando…' : '↻ Testar chave'}
            </button>
          </div>
        </div>
        {tokenStatus?.ok && (
          <div className="mt-3 pt-3 border-t border-[--border] grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tokenStatus.wabaId && (
              <div className="text-xs">
                <span className="text-[--muted-foreground]">WABA ID</span>
                <p className="font-mono text-[11px] truncate">{tokenStatus.wabaId}</p>
              </div>
            )}
            {tokenStatus.phoneId && (
              <div className="text-xs">
                <span className="text-[--muted-foreground]">Phone ID</span>
                <p className="font-mono text-[11px] truncate">{tokenStatus.phoneId}</p>
              </div>
            )}
            {tokenStatus.userId && (
              <div className="text-xs">
                <span className="text-[--muted-foreground]">User ID</span>
                <p className="font-mono text-[11px] truncate">{tokenStatus.userId}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Aviso sobre o fluxo */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300 space-y-1">
        <p className="font-semibold">Como funciona</p>
        <p>Crie o template aqui → copie o nome exato → submeta no <strong>Meta Business Manager</strong> → aguarde aprovação → sincronize o status. Após aprovado, o sistema usa automaticamente o template quando a janela de 24h estiver fechada.</p>
      </div>

      {/* Lista */}
      {templates.length === 0 ? (
        <div className="rounded-xl border border-[--border] p-12 text-center text-[--muted-foreground]">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">Nenhum template cadastrado</p>
          <p className="text-sm mt-1">Crie seu primeiro template para habilitar follow-ups após 24h</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-[--border] bg-[--card] p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{t.displayName}</span>
                    {t.actionType && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[--primary]/15 text-[--primary]">
                        {ACTION_LABELS[t.actionType] || t.actionType}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.metaStatus || 'PENDENTE_ENVIO'] || STATUS_STYLE.PENDENTE_ENVIO}`}>
                      {STATUS_LABEL[t.metaStatus || 'PENDENTE_ENVIO'] || t.metaStatus}
                    </span>
                  </div>
                  <code className="text-xs text-[--muted-foreground] font-mono">{t.name}</code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => sincronizar(t)}
                    disabled={syncingId === t.id}
                    title="Sincronizar status com a Meta"
                    className="px-3 py-1.5 rounded-lg border border-[--border] text-xs text-[--muted-foreground] hover:text-[--foreground] hover:border-[--foreground]/30 transition disabled:opacity-50"
                  >
                    {syncingId === t.id ? 'Sincronizando...' : '↻ Sync'}
                  </button>
                  <button
                    onClick={() => excluir(t)}
                    disabled={deletingId === t.id}
                    className="px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
                  >
                    Excluir
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg bg-[--accent]/40 p-3 text-sm text-[--foreground] whitespace-pre-wrap leading-relaxed border-l-2 border-[--primary]">
                {previewBody(t)}
              </div>

              {/* Variáveis */}
              {(t.variables as { index: number; description: string }[] | null)?.length ? (
                <div className="flex flex-wrap gap-2">
                  {(t.variables as { index: number; description: string }[]).map((v) => (
                    <span key={v.index} className="text-xs px-2 py-0.5 rounded bg-[--accent] text-[--muted-foreground]">
                      {'{{'}{ v.index }{'}}' } → {v.description}
                    </span>
                  ))}
                </div>
              ) : null}

              {t.lastSyncAt && (
                <p className="text-xs text-[--muted-foreground]">
                  Último sync: {new Date(t.lastSyncAt).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[--border] bg-[--card] shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[--border]">
              <h2 className="font-bold text-base">Novo template WhatsApp</h2>
              <button onClick={() => setShowModal(false)} className="text-[--muted-foreground] hover:text-[--foreground] text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
              )}

              {/* Gerador IA */}
              <div className="rounded-xl border border-[--primary]/30 bg-[--primary]/5 p-4 space-y-3">
                <p className="text-sm font-semibold text-[--primary]">✨ Gerar com IA</p>
                <div>
                  <label className="block text-xs text-[--muted-foreground] mb-1">Descreva o contexto do template</label>
                  <textarea
                    value={aiContext}
                    onChange={(e) => setAiContext(e.target.value)}
                    placeholder="Ex: lead que recebeu orçamento mas ficou em silêncio por 2 dias. Quero lembrá-lo de forma suave."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary] resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[--muted-foreground] mb-1">Tipo de ação (opcional)</label>
                  <select
                    value={form.actionType}
                    onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary]"
                  >
                    <option value="">— Selecione —</option>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={gerarComIA}
                  disabled={aiLoading || !aiContext.trim()}
                  className="w-full py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                >
                  {aiLoading ? 'Gerando...' : '✨ Gerar texto'}
                </button>
                {aiExplanation && (
                  <p className="text-xs text-[--muted-foreground] italic">{aiExplanation}</p>
                )}
              </div>

              {/* Campos manuais */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Nome para o painel</label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="Ex: Follow-up de orçamento"
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Nome na Meta (snake_case)</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                    placeholder="Ex: orcamento_followup"
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[--primary]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[--muted-foreground] mb-1">
                  Texto do template
                  <span className="ml-2 font-normal text-[--muted-foreground]">Use {'{{1}}'}, {'{{2}}'} para variáveis</span>
                </label>
                <textarea
                  value={form.bodyText}
                  onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
                  placeholder="Ex: Olá {{1}}! Tudo bem? Vi que você tinha interesse em energia solar..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary] resize-none"
                />
                <p className="text-xs text-[--muted-foreground] mt-1">{form.bodyText.length}/1024 caracteres</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Categoria Meta</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary]"
                  >
                    <option value="MARKETING">MARKETING</option>
                    <option value="UTILITY">UTILITY</option>
                    <option value="AUTHENTICATION">AUTHENTICATION</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[--muted-foreground] mb-1">Etapa vinculada</label>
                  <select
                    value={form.actionType}
                    onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary]"
                  >
                    <option value="">— Nenhuma —</option>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Variáveis detectadas */}
              {form.bodyText && (() => {
                const matches = [...form.bodyText.matchAll(/\{\{(\d+)\}\}/g)]
                const indexes = [...new Set(matches.map((m) => parseInt(m[1])))]
                if (!indexes.length) return null
                return (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[--muted-foreground]">Descrição das variáveis detectadas</label>
                    {indexes.sort((a, b) => a - b).map((idx) => {
                      const existing = form.variables.find((v) => v.index === idx)
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-[--accent] px-2 py-1 rounded shrink-0">{'{{' + idx + '}}'}</span>
                          <input
                            type="text"
                            placeholder={`Descreva a variável ${idx}`}
                            value={existing?.description || ''}
                            onChange={(e) => {
                              const desc = e.target.value
                              setForm((f) => {
                                const vars = f.variables.filter((v) => v.index !== idx)
                                return { ...f, variables: [...vars, { index: idx, description: desc }].sort((a, b) => a.index - b.index) }
                              })
                            }}
                            className="flex-1 px-3 py-1.5 rounded-lg border border-[--border] bg-[--card] text-sm focus:outline-none focus:ring-2 focus:ring-[--primary]"
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Dica submissão Meta */}
              <div className="rounded-lg border border-[--border] bg-[--accent]/30 p-3 text-xs text-[--muted-foreground] space-y-1">
                <p className="font-semibold text-[--foreground]">Próximos passos após salvar</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Acesse <strong>Meta Business Manager → WhatsApp → Modelos de mensagem</strong></li>
                  <li>Crie um modelo com o mesmo nome exato: <code className="font-mono">{form.name || 'nome_do_template'}</code></li>
                  <li>Cole o texto acima e submeta para aprovação</li>
                  <li>Volte aqui e clique em <strong>↻ Sync</strong> para verificar o status</li>
                </ol>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-[--border] flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg border border-[--border] text-sm text-[--muted-foreground] hover:text-[--foreground] transition"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={saving || !form.name.trim() || !form.bodyText.trim()}
                className="px-5 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
