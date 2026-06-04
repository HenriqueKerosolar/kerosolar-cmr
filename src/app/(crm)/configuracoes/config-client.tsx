'use client'

import { useState } from 'react'

type Cfg = Record<string, string>

export function ConfigClient({ initial }: { initial: Cfg }) {
  const [cfg, setCfg] = useState<Cfg>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (key: string, value: string) => setCfg((c) => ({ ...c, [key]: value }))

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

      <button onClick={save} disabled={saving}
        className="px-6 py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] font-medium text-sm disabled:opacity-60 transition hover:opacity-90">
        {saving ? 'Salvando…' : saved ? '✓ Salvo!' : 'Salvar configurações'}
      </button>
    </div>
  )
}
