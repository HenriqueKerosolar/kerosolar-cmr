'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createPipeline, updatePipeline, deletePipeline,
  addStage, updateStage, deleteStage, setPipelineChannels,
} from '@/app/actions/funnels'
import { StageFlowBuilder, type FlowBlock, type NoReply } from './stage-flow-builder'

type StageFlow = { blocks?: FlowBlock[]; openingMessages?: unknown[]; handoffToAi?: boolean; keywordRules?: unknown[]; noReplyMinutes?: number; noReplyTargetStageId?: string }
type Stage = {
  id: string; name: string; color: string | null; sortOrder: number
  isWon: boolean; isLost: boolean; botEnabled: boolean; botPrompt: string | null
  flow: StageFlow | null
}
type Pipeline = {
  id: string; name: string; icon: string | null; description: string | null
  isDefault: boolean; botEnabled: boolean; botName: string | null
  botPrompt: string | null; aiModel: string | null
  sendStartHour: number; sendEndHour: number
  stages: Stage[]
  whatsappAccounts: { accountId: string }[]
  _count: { leads: number }
}
type Account = { id: string; label: string; phone: string | null; status: string }

const COLORS = ['#3b82f6', '#eab308', '#f97316', '#a855f7', '#22c55e', '#ef4444', '#06b6d4', '#ec4899', '#64748b']
const ICONS = ['📁', '💰', '🔧', '🤝', '☀️', '⚡', '🏠', '📞', '🎯', '🛠️']

export function FunisClient({ pipelines, accounts }: { pipelines: Pipeline[]; accounts: Account[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selectedId, setSelectedId] = useState(pipelines[0]?.id ?? '')
  const [tab, setTab] = useState<'etapas' | 'ia' | 'canais'>('etapas')

  const selected = pipelines.find((p) => p.id === selectedId) ?? pipelines[0]
  const refresh = () => router.refresh()
  const run = (fn: () => Promise<unknown>) => startTransition(async () => { try { await fn(); refresh() } catch (e) { alert(e instanceof Error ? e.message : 'Erro') } })

  // ── estados de edição local ──
  const [newFunnelName, setNewFunnelName] = useState('')

  return (
    <div className="flex h-full">
      {/* ── Lista de funis ── */}
      <div className="w-60 border-r border-[--border] bg-[--sidebar] flex flex-col shrink-0">
        <div className="p-4 border-b border-[--border]">
          <h2 className="font-bold text-sm">Funis</h2>
          <p className="text-xs text-[--muted-foreground]">{pipelines.length} funis</p>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {pipelines.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${selectedId === p.id ? 'bg-[--primary] text-[--primary-foreground]' : 'hover:bg-[--accent]'}`}>
              <span>{p.icon ?? '📁'}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className={`text-[10px] ${selectedId === p.id ? 'opacity-80' : 'text-[--muted-foreground]'}`}>{p._count.leads}</span>
            </button>
          ))}
        </div>
        <div className="p-2 border-t border-[--border] space-y-2">
          <input value={newFunnelName} onChange={(e) => setNewFunnelName(e.target.value)}
            placeholder="Nome do novo funil"
            className="w-full px-2 py-1.5 rounded-lg border border-[--input] bg-[--background] text-xs outline-none" />
          <button disabled={pending || !newFunnelName.trim()}
            onClick={() => run(async () => { const id = await createPipeline({ name: newFunnelName }); setNewFunnelName(''); setSelectedId(id as string) })}
            className="w-full py-1.5 rounded-lg bg-[--primary] text-[--primary-foreground] text-xs font-medium disabled:opacity-50">
            + Criar funil
          </button>
        </div>
      </div>

      {/* ── Editor do funil ── */}
      {selected && (
        <div className="flex-1 overflow-auto">
          {/* Cabeçalho */}
          <div className="p-5 border-b border-[--border] flex items-start gap-4 flex-wrap">
            <div className="flex gap-1">
              {ICONS.map((ic) => (
                <button key={ic} onClick={() => run(() => updatePipeline(selected.id, { icon: ic }))}
                  className={`w-8 h-8 rounded-lg text-base ${selected.icon === ic ? 'bg-[--primary]/20 ring-2 ring-[--primary]' : 'hover:bg-[--accent]'}`}>{ic}</button>
              ))}
            </div>
            <div className="flex-1 min-w-[200px]">
              <input defaultValue={selected.name} key={`name-${selected.id}`}
                onBlur={(e) => e.target.value !== selected.name && run(() => updatePipeline(selected.id, { name: e.target.value }))}
                className="text-xl font-bold bg-transparent border-b border-transparent hover:border-[--border] focus:border-[--primary] outline-none w-full" />
              <input defaultValue={selected.description ?? ''} key={`desc-${selected.id}`} placeholder="Descrição do funil…"
                onBlur={(e) => run(() => updatePipeline(selected.id, { description: e.target.value }))}
                className="text-sm text-[--muted-foreground] bg-transparent outline-none w-full mt-1" />
            </div>
            {!selected.isDefault && (
              <button onClick={() => confirm(`Excluir o funil "${selected.name}"?`) && run(() => deletePipeline(selected.id))}
                className="text-xs text-[--destructive] hover:underline">Excluir funil</button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 pt-3 border-b border-[--border]">
            {([['etapas', '📊 Etapas'], ['ia', '🤖 IA do funil'], ['canais', '📱 Canais']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-2 text-sm rounded-t-lg border-b-2 transition ${tab === k ? 'border-[--primary] text-[--primary] font-medium' : 'border-transparent text-[--muted-foreground]'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'etapas' && <StagesEditor key={selected.id} pipeline={selected} run={run} pending={pending} />}
            {tab === 'ia'     && <AiEditor     key={selected.id} pipeline={selected} run={run} pending={pending} />}
            {tab === 'canais' && <ChannelsEditor key={selected.id} pipeline={selected} accounts={accounts} run={run} pending={pending} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Editor de Etapas ──────────────────────────────────────────────────────────
function StagesEditor({ pipeline, run, pending }: { pipeline: Pipeline; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const [newStage, setNewStage] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-sm text-[--muted-foreground]">Cada etapa pode ter seu próprio <b>bot</b> (a "chamada" que dispara quando o lead entra) e seu próprio <b>script de IA</b>. Clique em ⚙️ Bot/IA.</p>
      {pipeline.stages.map((s) => (
        <div key={s.id} className="rounded-xl border border-[--border] bg-[--card] overflow-hidden">
          <div className="flex items-center gap-3 p-3">
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => run(() => updateStage(s.id, { color: c }))}
                  className={`w-5 h-5 rounded-full ${s.color === c ? 'ring-2 ring-offset-1 ring-[--foreground]' : ''}`} style={{ background: c }} />
              ))}
            </div>
            <input defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && run(() => updateStage(s.id, { name: e.target.value }))}
              className="flex-1 bg-transparent outline-none text-sm font-medium border-b border-transparent focus:border-[--primary]" />
            <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition ${expanded === s.id ? 'bg-[--primary] text-[--primary-foreground] border-[--primary]' : 'border-[--border] hover:bg-[--accent]'}`}>
              ⚙️ Bot/IA
            </button>
            <button onClick={() => run(() => deleteStage(s.id))} className="text-[--destructive] text-xs hover:underline">🗑</button>
          </div>
          {expanded === s.id && <StageBotPanel stage={s} allStages={pipeline.stages} run={run} pending={pending} />}
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Nome da nova etapa"
          className="flex-1 px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
        <button disabled={pending || !newStage.trim()} onClick={() => { run(() => addStage(pipeline.id, newStage)); setNewStage('') }}
          className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">+ Etapa</button>
      </div>
    </div>
  )
}

// ─── Configurador de Bot + IA de uma etapa ──────────────────────────────────────
function StageBotPanel({ stage, allStages, run, pending }: { stage: Stage; allStages: Stage[]; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const initial = (stage.flow ?? {}) as { blocks?: FlowBlock[]; noReply?: NoReply }
  const [blocks, setBlocks] = useState<FlowBlock[]>(initial.blocks ?? [])
  const [noReply, setNoReply] = useState<NoReply>(initial.noReply ?? { minutes: 0 })
  const [prompt, setPrompt] = useState(stage.botPrompt ?? '')
  const [saved, setSaved] = useState(false)

  const save = () => {
    setSaved(false)
    run(async () => {
      await updateStage(stage.id, {
        botPrompt: prompt,
        flow: { blocks, noReply: noReply.minutes > 0 ? noReply : undefined },
      })
      setSaved(true)
    })
  }

  return (
    <div className="border-t border-[--border] bg-[--muted]/20 p-4 space-y-5">
      {/* Liga/desliga bot da etapa */}
      <div className="flex items-center gap-3">
        <button onClick={() => run(() => updateStage(stage.id, { botEnabled: !stage.botEnabled }))}
          className={`relative w-11 h-6 rounded-full transition ${stage.botEnabled ? 'bg-[--primary]' : 'bg-[--muted]'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${stage.botEnabled ? 'left-5' : 'left-0.5'}`} />
        </button>
        <span className="text-sm font-medium">Bot/IA ativo nesta etapa</span>
      </div>

      {/* Construtor de blocos */}
      <div>
        <p className="text-sm font-medium mb-1">🤖 Fluxo do bot (blocos)</p>
        <p className="text-xs text-[--muted-foreground] mb-2">Monte o fluxo em sequência. Ele roda quando o lead <b>entra</b> nesta etapa. Use {'{nome}'} nas mensagens.</p>
        <StageFlowBuilder blocks={blocks} setBlocks={setBlocks} noReply={noReply} setNoReply={setNoReply} allStages={allStages.filter((s) => s.id !== stage.id)} />
      </div>

      {/* Script de IA da etapa */}
      <div>
        <p className="text-sm font-medium mb-1">🧠 Script de IA desta etapa</p>
        <p className="text-xs text-[--muted-foreground] mb-2">Usado quando o fluxo chega no bloco "Entregar p/ IA". Substitui o prompt do funil. Use {'{BOT_NAME}'}.</p>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6}
          placeholder={'Ex: Você é {BOT_NAME}. O cliente já foi qualificado. Conduza para o fechamento...'}
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none font-mono" />
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} onClick={save}
          className="px-5 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
          {pending ? 'Salvando…' : 'Salvar fluxo da etapa'}
        </button>
        {saved && !pending && <span className="text-sm text-green-600 font-medium">✅ Fluxo salvo!</span>}
      </div>
    </div>
  )
}

// ─── Editor de IA do funil ──────────────────────────────────────────────────────
function AiEditor({ pipeline, run, pending }: { pipeline: Pipeline; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const [name, setName] = useState(pipeline.botName ?? '')
  const [prompt, setPrompt] = useState(pipeline.botPrompt ?? '')
  const [model, setModel] = useState(pipeline.aiModel ?? '')
  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3 p-4 rounded-xl border border-[--border] bg-[--card]">
        <div>
          <p className="font-medium text-sm">IA ativa neste funil</p>
          <p className="text-xs text-[--muted-foreground]">Quando ligada, o bot responde automaticamente os leads deste funil.</p>
        </div>
        <button onClick={() => run(() => updatePipeline(pipeline.id, { botEnabled: !pipeline.botEnabled }))}
          className={`ml-auto relative w-12 h-6 rounded-full transition ${pipeline.botEnabled ? 'bg-[--primary]' : 'bg-[--muted]'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${pipeline.botEnabled ? 'left-6' : 'left-0.5'}`} />
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Nome do bot</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Sol"
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Script / Prompt da IA deste funil</label>
        <p className="text-xs text-[--muted-foreground] mb-1">Deixe em branco para usar o prompt padrão KeroSolar. Use {'{BOT_NAME}'} para o nome do bot.</p>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12}
          placeholder="Você é {BOT_NAME}, atendente da KeroSolar especializada em..."
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none font-mono" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Modelo de IA (opcional)</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-3-5-sonnet-20241022 ou gpt-4o-mini"
          className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
      </div>

      <button disabled={pending} onClick={() => run(() => updatePipeline(pipeline.id, { botName: name, botPrompt: prompt, aiModel: model }))}
        className="px-6 py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
        {pending ? 'Salvando…' : 'Salvar IA do funil'}
      </button>

      {/* Janela de horário de envio do funil */}
      <div className="pt-4 border-t border-[--border]">
        <p className="text-sm font-medium mb-1">🕘 Horário de envio das mensagens automáticas (dias úteis)</p>
        <p className="text-xs text-[--muted-foreground] mb-2">Mensagens de bot/chamadas/disparos só saem nesta faixa. Nada é enviado após 21h. Padrão 9h–18h.</p>
        <div className="flex items-center gap-2 text-sm">
          <span>Das</span>
          <select defaultValue={pipeline.sendStartHour} onChange={(e) => run(() => updatePipeline(pipeline.id, { sendStartHour: parseInt(e.target.value) }))}
            className="px-2 py-1 rounded border border-[--input] bg-[--background]">
            {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
          <span>às</span>
          <select defaultValue={pipeline.sendEndHour} onChange={(e) => run(() => updatePipeline(pipeline.id, { sendEndHour: parseInt(e.target.value) }))}
            className="px-2 py-1 rounded border border-[--input] bg-[--background]">
            {Array.from({ length: 16 }, (_, i) => i + 7).map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}

// ─── Editor de Canais ────────────────────────────────────────────────────────────
function ChannelsEditor({ pipeline, accounts, run, pending }: { pipeline: Pipeline; accounts: Account[]; run: (fn: () => Promise<unknown>) => void; pending: boolean }) {
  const active = new Set(pipeline.whatsappAccounts.map((a) => a.accountId))
  const [selected, setSelected] = useState<Set<string>>(active)
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-[--muted-foreground]">Escolha quais números de WhatsApp ficam ativos neste funil. Mensagens recebidas nesses números criam leads aqui.</p>
      {accounts.length === 0 ? (
        <div className="p-4 rounded-xl border border-dashed border-[--border] text-sm text-[--muted-foreground] text-center">
          Nenhum WhatsApp conectado ainda. Vá em <b>WhatsApp</b> no menu para conectar um número.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-[--border] bg-[--card] cursor-pointer">
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-lg">🟢</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{a.label}</p>
                <p className="text-xs text-[--muted-foreground]">{a.phone ?? 'não conectado'} · {a.status}</p>
              </div>
            </label>
          ))}
          <button disabled={pending} onClick={() => run(() => setPipelineChannels(pipeline.id, [...selected]))}
            className="px-6 py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
            Salvar canais
          </button>
        </div>
      )}
    </div>
  )
}
