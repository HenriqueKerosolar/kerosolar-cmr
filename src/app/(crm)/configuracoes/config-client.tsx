'use client'

import { useState, useEffect } from 'react'

type Cfg = Record<string, string>
type Variant = { id: string; text: string; enabled?: boolean }
type PlacarRow = { id: string; sent: number; replied: number; rate: number }

// Tabela de financiamento padrão (usada quando ainda não há configuração salva).
type FinRow = { prazo: number; taxa: number; parcela: number }
const FIN_DEFAULT_REF = 20870
const FIN_DEFAULT_ROWS: FinRow[] = [
  { prazo: 24, taxa: 1.54, parcela: 1196.70 },
  { prazo: 30, taxa: 1.60, parcela: 1010.51 },
  { prazo: 36, taxa: 1.65, parcela: 888.95 },
  { prazo: 48, taxa: 1.69, parcela: 735.39 },
  { prazo: 60, taxa: 1.73, parcela: 648.99 },
  { prazo: 72, taxa: 1.82, parcela: 606.14 },
  { prazo: 84, taxa: 1.91, parcela: 583.61 },
  { prazo: 96, taxa: 1.95, parcela: 563.61 },
]

export function ConfigClient({ initial, variants, defaults, placar }: { initial: Cfg; variants: Variant[]; defaults: Variant[]; placar: PlacarRow[] }) {
  const [cfg, setCfg] = useState<Cfg>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (key: string, value: string) => setCfg((c) => ({ ...c, [key]: value }))

  // ── Saudação inicial: variações (teste A/B com aprendizado) ──
  const [wVars, setWVars] = useState<Variant[]>(variants.map((v) => ({ ...v, enabled: v.enabled !== false })))
  useEffect(() => {
    setCfg((c) => ({ ...c, welcome_variants: JSON.stringify(wVars) }))
  }, [wVars])
  const setVarText = (i: number, text: string) => setWVars((vs) => vs.map((v, idx) => (idx === i ? { ...v, text } : v)))
  const toggleVar = (i: number) => setWVars((vs) => vs.map((v, idx) => (idx === i ? { ...v, enabled: !(v.enabled !== false) } : v)))
  const removeVar = (i: number) => setWVars((vs) => vs.filter((_, idx) => idx !== i))
  const addVar = () => setWVars((vs) => [...vs, { id: `var${vs.length + 1}-${Math.random().toString(36).slice(2, 6)}`, text: '', enabled: true }])
  const resetVars = () => setWVars(defaults.map((v) => ({ ...v, enabled: v.enabled !== false })))
  const placarDe = (id: string) => placar.find((p) => p.id === id)
  const melhorId = placar.filter((p) => p.sent >= 5).sort((a, b) => b.rate - a.rate)[0]?.id

  // ── Tabela de financiamento (estado próprio, sincronizado para dentro de cfg) ──
  const initialFin = (() => {
    try {
      const o = JSON.parse(initial['financing_table'] || '')
      if (o && typeof o.valorReferencia === 'number' && Array.isArray(o.linhas) && o.linhas.length > 0) {
        return { ref: Number(o.valorReferencia), rows: o.linhas as FinRow[] }
      }
    } catch { /* usa padrão */ }
    return { ref: FIN_DEFAULT_REF, rows: FIN_DEFAULT_ROWS }
  })()
  const [finRef, setFinRef] = useState<number>(initialFin.ref)
  const [finRows, setFinRows] = useState<FinRow[]>(initialFin.rows)

  // Sempre que a tabela muda, grava o JSON dentro de cfg para o save() existente enviar.
  useEffect(() => {
    setCfg((c) => ({ ...c, financing_table: JSON.stringify({ valorReferencia: finRef, linhas: finRows }) }))
  }, [finRef, finRows])

  const setFinRow = (i: number, field: keyof FinRow, value: number) =>
    setFinRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  const addFinRow = () => setFinRows((rows) => [...rows, { prazo: 0, taxa: 0, parcela: 0 }])
  const removeFinRow = (i: number) => setFinRows((rows) => rows.filter((_, idx) => idx !== i))
  const resetFin = () => { setFinRef(FIN_DEFAULT_REF); setFinRows(FIN_DEFAULT_ROWS) }

  async function save() {
    setSaving(true)
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  const Field = ({ label, k, type = 'text', placeholder = '' }: { label: string; k: string; type?: string; placeholder?: string }) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type={type} value={cfg[k] ?? ''} onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
      />
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-8">
      <h1 className="text-xl font-bold">Configurações</h1>

      {/* IA */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Inteligência Artificial</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Provedor</label>
          <select value={cfg['ai_provider'] ?? ''} onChange={(e) => set('ai_provider', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none">
            <option value="">Auto (usa a chave disponível)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </div>
        <Field label="Chave Anthropic (Claude)" k="anthropic_key" type="password" placeholder="sk-ant-..." />
        <Field label="Chave OpenAI (GPT)" k="openai_key" type="password" placeholder="sk-..." />
        <Field label="Modelo" k="ai_model" placeholder="claude-3-5-sonnet-20241022 ou gpt-4o-mini" />
      </section>

      {/* Transferência para humano */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Transferência para humano</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Mensagem enviada quando o cliente pede um humano / recusa o bot</label>
          <p className="text-xs text-[--muted-foreground] mb-1">Ao detectar que o cliente não quer falar com a IA, ela é desativada para ele e esta mensagem é enviada automaticamente.</p>
          <textarea value={cfg['handoff_message'] ?? ''} onChange={(e) => set('handoff_message', e.target.value)} rows={3}
            placeholder="A partir de agora vou te transferir para um atendente humano. Em breve você será atendido!"
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        </div>
      </section>

      {/* Fora do horário */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Recepção fora do horário (após 21h)</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Mensagem ao receber contato após 21h</label>
          <p className="text-xs text-[--muted-foreground] mb-1">A IA pergunta se quer deixar registrado ou prosseguir agora. Use {'{SAUDACAO}'} para Bom dia/Boa tarde/Boa noite.</p>
          <textarea value={cfg['after_hours_message'] ?? ''} onChange={(e) => set('after_hours_message', e.target.value)} rows={3}
            placeholder="{SAUDACAO}! Recebi sua mensagem. Quer começar o atendimento agora ou deixar registrado para o horário comercial?"
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mensagem de retomada (às 9h, se o cliente não respondeu)</label>
          <p className="text-xs text-[--muted-foreground] mb-1">Enviada automaticamente no horário comercial para quem recebeu o contato acima e ficou sem responder. Use {'{SAUDACAO}'} e {'{nome}'}.</p>
          <textarea value={cfg['after_hours_resume_message'] ?? ''} onChange={(e) => set('after_hours_resume_message', e.target.value)} rows={3}
            placeholder="{SAUDACAO}, {nome}! Retomando seu contato com a KeroSolar. Me envia a foto da sua conta de luz ou o consumo médio em kWh que já preparo seu orçamento!"
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        </div>
        <ResumeAfterHoursButton />
      </section>

      {/* Reengajamento */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Reengajamento (cliente sumiu 10+ dias)</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Mensagem quando o cliente retorna após 10 dias sem contato</label>
          <textarea value={cfg['return_message'] ?? ''} onChange={(e) => set('return_message', e.target.value)} rows={3}
            placeholder="Que bom que você retornou! Vamos continuar..."
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        </div>
      </section>

      {/* Saudação inicial — teste A/B com aprendizado */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Saudação inicial (teste A/B com aprendizado)</h2>
        <p className="text-xs text-[--muted-foreground]">
          Cadastre versões diferentes da <b>primeira mensagem</b>. O sistema alterna entre elas, mede quantas fazem o
          cliente <b>responder</b> e passa a usar mais a campeã automaticamente (e segue testando as outras de leve).
          Use <code>{'{SAUDACAO}'}</code> (Bom dia/Boa tarde/Boa noite) e <code>{'{nome}'}</code>.
          <b> Toda saudação sempre pede a conta de luz automaticamente</b> — se você escrever uma variação que não peça,
          o sistema completa sozinho com o pedido da conta (é o que mais faz o cliente responder).
        </p>

        {/* Placar */}
        <div className="rounded-lg border border-[--border] overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-xs font-medium text-[--muted-foreground] bg-[--muted]">
            <span>Variação</span><span className="text-right w-16">Enviadas</span><span className="text-right w-20">Responderam</span><span className="text-right w-16">Taxa</span>
          </div>
          {wVars.map((v) => {
            const p = placarDe(v.id)
            const sent = p?.sent ?? 0, replied = p?.replied ?? 0
            const rate = p && p.sent > 0 ? Math.round(p.rate * 100) : null
            return (
              <div key={v.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-sm border-t border-[--border] items-center">
                <span className="truncate flex items-center gap-1">
                  {melhorId === v.id && <span title="Campeã até agora">🏆</span>}
                  <span className={v.enabled !== false ? '' : 'opacity-40 line-through'}>{v.id}</span>
                </span>
                <span className="text-right w-16 tabular-nums">{sent}</span>
                <span className="text-right w-20 tabular-nums">{replied}</span>
                <span className="text-right w-16 tabular-nums font-medium">{rate == null ? '—' : `${rate}%`}</span>
              </div>
            )
          })}
        </div>

        {/* Editor das variações */}
        <div className="space-y-3">
          {wVars.map((v, i) => (
            <div key={v.id} className="rounded-lg border border-[--border] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={v.enabled !== false} onChange={() => toggleVar(i)} />
                  {v.id} {v.enabled === false && <span className="text-xs text-[--muted-foreground]">(desativada)</span>}
                </label>
                <button type="button" onClick={() => removeVar(i)} title="Remover variação"
                  className="px-2 py-1 rounded-lg border border-[--border] text-xs text-red-600 hover:bg-red-50 transition">✕</button>
              </div>
              <textarea value={v.text} onChange={(e) => setVarText(i, e.target.value)} rows={3}
                placeholder="{SAUDACAO}, {nome}! ... me diz quanto vem sua conta de luz que já te mostro a economia ⚡"
                className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]" />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={addVar}
              className="px-3 py-1.5 rounded-lg border border-[--border] text-sm hover:bg-[--muted] transition">+ Adicionar variação</button>
            <button type="button" onClick={resetVars}
              className="px-3 py-1.5 rounded-lg border border-[--border] text-sm text-[--muted-foreground] hover:bg-[--muted] transition">Restaurar padrão</button>
          </div>
        </div>
      </section>

      {/* Bot */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Agente / Salesbot</h2>
        <Field label="Nome do bot" k="bot_name" placeholder="Sol" />
        <div>
          <label className="block text-sm font-medium mb-1">Prompt do sistema (deixe em branco para usar o padrão KeroSolar)</label>
          <textarea value={cfg['bot_prompt'] ?? ''} onChange={(e) => set('bot_prompt', e.target.value)}
            rows={8} placeholder="Você é {BOT_NAME}..."
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring] font-mono"
          />
        </div>
      </section>

      {/* Financiamento — tabela do banco */}
      <section className="space-y-4">
        <h2 className="font-semibold border-b border-[--border] pb-2">Financiamento (tabela do banco)</h2>
        <p className="text-xs text-[--muted-foreground]">
          Faça uma simulação no banco com um valor de projeto e copie aqui as parcelas de cada prazo.
          O sistema calcula o <b>fator</b> de cada parcela automaticamente (parcela ÷ valor de referência) —
          já embutindo juros, carência de 120 dias, IOF e seguro. Assim o orçamento da IA bate com a simulação real.
        </p>

        <div className="max-w-xs">
          <label className="block text-sm font-medium mb-1">Valor de referência do projeto (R$)</label>
          <input
            type="number" inputMode="decimal" step="0.01" value={Number.isFinite(finRef) ? finRef : ''}
            onChange={(e) => setFinRef(parseFloat(e.target.value) || 0)}
            placeholder="20870"
            className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
          />
          <p className="text-xs text-[--muted-foreground] mt-1">O mesmo valor de projeto que você usou na simulação do banco.</p>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 text-xs font-medium text-[--muted-foreground] px-1">
            <span>Prazo (meses)</span>
            <span>Taxa (% a.m.)</span>
            <span>Parcela (R$)</span>
            <span></span>
          </div>
          {finRows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-center">
              <input type="number" inputMode="numeric" value={row.prazo || ''} onChange={(e) => setFinRow(i, 'prazo', parseInt(e.target.value, 10) || 0)}
                placeholder="36" className="px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]" />
              <input type="number" inputMode="decimal" step="0.01" value={row.taxa || ''} onChange={(e) => setFinRow(i, 'taxa', parseFloat(e.target.value) || 0)}
                placeholder="1.65" className="px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]" />
              <input type="number" inputMode="decimal" step="0.01" value={row.parcela || ''} onChange={(e) => setFinRow(i, 'parcela', parseFloat(e.target.value) || 0)}
                placeholder="888.95" className="px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]" />
              <button type="button" onClick={() => removeFinRow(i)} title="Remover prazo"
                className="px-3 py-2 rounded-lg border border-[--border] text-sm text-red-600 hover:bg-red-50 transition">✕</button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={addFinRow}
              className="px-3 py-1.5 rounded-lg border border-[--border] text-sm hover:bg-[--muted] transition">+ Adicionar prazo</button>
            <button type="button" onClick={resetFin}
              className="px-3 py-1.5 rounded-lg border border-[--border] text-sm text-[--muted-foreground] hover:bg-[--muted] transition">Restaurar padrão</button>
          </div>
        </div>
      </section>

      <button onClick={save} disabled={saving}
        className="px-6 py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] font-medium text-sm disabled:opacity-60 transition hover:opacity-90">
        {saving ? 'Salvando…' : saved ? '✓ Salvo!' : 'Salvar configurações'}
      </button>
    </div>
  )
}

/** Botão que dispara a retomada (1x) dos leads que ficaram sem responder fora do horário. */
function ResumeAfterHoursButton() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  async function run() {
    if (!confirm('Armar a retomada para os leads que receberam o contato fora do horário e não responderam?\n\nA IA vai falar com eles no próximo horário comercial (9h).')) return
    setLoading(true); setMsg('')
    try {
      const res = await fetch('/api/crm/resume-afterhours', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const quando = data.runAt ? new Date(data.runAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''
        setMsg(`✓ ${data.armados} lead(s) armado(s) de ${data.candidatos} candidato(s). Retomada em: ${quando}.`)
      } else {
        setMsg(`Erro: ${data.error || 'falhou'}`)
      }
    } catch {
      setMsg('Erro de conexão.')
    }
    setLoading(false)
  }

  return (
    <div className="pt-2">
      <button type="button" onClick={run} disabled={loading}
        className="px-4 py-2 rounded-lg border border-[--border] text-sm font-medium disabled:opacity-60 hover:bg-[--muted] transition">
        {loading ? 'Armando…' : '🌅 Retomar agora os leads parados (fora do horário)'}
      </button>
      {msg && <p className="text-xs mt-2 text-[--muted-foreground]">{msg}</p>}
    </div>
  )
}
