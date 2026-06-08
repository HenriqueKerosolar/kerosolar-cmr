'use client'

import { useState } from 'react'

export type FlowBlock = {
  id: string
  type: 'message' | 'wait' | 'question' | 'condition' | 'move_stage' | 'task' | 'notify' | 'ai' | 'handoff'
  text?: string
  mediaUrl?: string
  minutes?: number
  field?: string
  source?: 'field' | 'reply'
  op?: 'contains' | 'equals'
  value?: string
  gotoId?: string
  targetStageId?: string
  title?: string
}

type Stage = { id: string; name: string }

const TIPOS: { type: FlowBlock['type']; label: string; icon: string }[] = [
  { type: 'message',    label: 'Enviar mensagem', icon: '💬' },
  { type: 'wait',       label: 'Esperar',         icon: '⏱️' },
  { type: 'question',   label: 'Perguntar (salva resposta)', icon: '❓' },
  { type: 'condition',  label: 'Condição (se/então)', icon: '🔀' },
  { type: 'move_stage', label: 'Mover de etapa',  icon: '➡️' },
  { type: 'task',       label: 'Criar tarefa',    icon: '📌' },
  { type: 'notify',     label: 'Sinalizar p/ mim', icon: '🔔' },
  { type: 'ai',         label: 'Entregar p/ IA',  icon: '🤖' },
  { type: 'handoff',    label: 'Transferir p/ humano', icon: '🙋' },
]

const uid = () => Math.random().toString(36).slice(2, 9)

export type NoReply = { minutes: number; message?: string; targetStageName?: string }

export function StageFlowBuilder({ blocks, setBlocks, allStages, noReply, setNoReply }: {
  blocks: FlowBlock[]
  setBlocks: (b: FlowBlock[]) => void
  allStages: Stage[]
  noReply: NoReply
  setNoReply: (n: NoReply) => void
}) {
  const [addOpen, setAddOpen] = useState(false)

  const add = (type: FlowBlock['type']) => {
    const base: FlowBlock = { id: uid(), type }
    if (type === 'condition') { base.source = 'reply'; base.op = 'contains' }
    if (type === 'wait') base.minutes = 60
    setBlocks([...blocks, base]); setAddOpen(false)
  }
  const upd = (id: string, patch: Partial<FlowBlock>) => setBlocks(blocks.map((b) => b.id === id ? { ...b, ...patch } : b))
  const del = (id: string) => setBlocks(blocks.filter((b) => b.id !== id))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const copy = [...blocks];[copy[i], copy[j]] = [copy[j], copy[i]]; setBlocks(copy)
  }

  const input = 'w-full px-2 py-1.5 rounded border border-[--input] bg-[--background] text-sm outline-none'

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const meta = TIPOS.find((t) => t.type === b.type)!
        return (
          <div key={b.id} className="rounded-lg border border-[--border] bg-[--card] p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-[--muted-foreground]">{i + 1}.</span>
              <span>{meta.icon} {meta.label}</span>
              <div className="ml-auto flex items-center gap-1 text-xs">
                <button onClick={() => move(i, -1)} className="px-1 hover:bg-[--accent] rounded">↑</button>
                <button onClick={() => move(i, 1)} className="px-1 hover:bg-[--accent] rounded">↓</button>
                <button onClick={() => del(b.id)} className="px-1 text-[--destructive]">🗑</button>
              </div>
            </div>

            {b.type === 'message' && (
              <>
                <textarea value={b.text ?? ''} onChange={(e) => upd(b.id, { text: e.target.value })} rows={2} placeholder="Texto (use {nome})" className={input} />
                <input value={b.mediaUrl ?? ''} onChange={(e) => upd(b.id, { mediaUrl: e.target.value })} placeholder="(opcional) URL de imagem/vídeo/PDF" className={input + ' text-xs'} />
              </>
            )}
            {b.type === 'wait' && (
              <div className="flex items-center gap-2 text-sm">Esperar
                <input type="number" min={0} value={b.minutes ?? 0} onChange={(e) => upd(b.id, { minutes: parseInt(e.target.value) || 0 })} className="w-24 px-2 py-1 rounded border border-[--input] bg-[--background] text-right" /> minutos
              </div>
            )}
            {b.type === 'question' && (
              <>
                <textarea value={b.text ?? ''} onChange={(e) => upd(b.id, { text: e.target.value })} rows={2} placeholder="Pergunta a enviar" className={input} />
                <input value={b.field ?? ''} onChange={(e) => upd(b.id, { field: e.target.value })} placeholder="Salvar resposta no campo (ex: telhado)" className={input + ' text-xs'} />
              </>
            )}
            {b.type === 'condition' && (
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span>Se</span>
                  <select value={b.source ?? 'reply'} onChange={(e) => upd(b.id, { source: e.target.value as 'field' | 'reply' })} className="px-1 py-1 rounded border border-[--input] bg-[--background]">
                    <option value="reply">a última resposta</option>
                    <option value="field">o campo</option>
                  </select>
                  {b.source === 'field' && <input value={b.field ?? ''} onChange={(e) => upd(b.id, { field: e.target.value })} placeholder="campo" className="w-24 px-2 py-1 rounded border border-[--input] bg-[--background]" />}
                  <select value={b.op ?? 'contains'} onChange={(e) => upd(b.id, { op: e.target.value as 'contains' | 'equals' })} className="px-1 py-1 rounded border border-[--input] bg-[--background]">
                    <option value="contains">contém</option>
                    <option value="equals">é igual a</option>
                  </select>
                  <input value={b.value ?? ''} onChange={(e) => upd(b.id, { value: e.target.value })} placeholder="valor" className="w-28 px-2 py-1 rounded border border-[--input] bg-[--background]" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span>→ pular para o bloco</span>
                  <select value={b.gotoId ?? ''} onChange={(e) => upd(b.id, { gotoId: e.target.value })} className="px-1 py-1 rounded border border-[--input] bg-[--background]">
                    <option value="">— escolha —</option>
                    {blocks.filter((x) => x.id !== b.id).map((x, idx) => <option key={x.id} value={x.id}>#{blocks.indexOf(x) + 1} {TIPOS.find((t) => t.type === x.type)?.label}</option>)}
                  </select>
                  <span className="text-xs text-[--muted-foreground]">(senão segue pro próximo)</span>
                </div>
              </div>
            )}
            {b.type === 'move_stage' && (
              <select value={b.targetStageId ?? ''} onChange={(e) => upd(b.id, { targetStageId: e.target.value })} className={input}>
                <option value="">— etapa de destino —</option>
                {allStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {b.type === 'task' && (
              <input value={b.title ?? ''} onChange={(e) => upd(b.id, { title: e.target.value })} placeholder="Título da tarefa" className={input} />
            )}
            {(b.type === 'notify' || b.type === 'ai' || b.type === 'handoff') && (
              <p className="text-xs text-[--muted-foreground]">
                {b.type === 'notify' && 'Marca o lead como prioritário e cria uma tarefa pra você.'}
                {b.type === 'ai' && 'A partir daqui a IA da etapa assume a conversa.'}
                {b.type === 'handoff' && 'Para o bot e transfere pra um atendente humano.'}
              </p>
            )}
          </div>
        )
      })}

      {addOpen ? (
        <div className="rounded-lg border border-dashed border-[--border] p-2 grid grid-cols-2 gap-1">
          {TIPOS.map((t) => (
            <button key={t.type} onClick={() => add(t.type)} className="text-left text-xs px-2 py-1.5 rounded hover:bg-[--accent]">{t.icon} {t.label}</button>
          ))}
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-[--border] hover:bg-[--accent]">+ Adicionar bloco</button>
      )}

      {/* Sem resposta (timeout das perguntas) */}
      <div className="mt-3 p-3 rounded-lg border border-[--border] bg-[--card] space-y-2">
        <p className="text-sm font-medium">⏳ Se o cliente não responder uma pergunta</p>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span>Após</span>
          <input type="number" min={0} value={noReply.minutes} onChange={(e) => setNoReply({ ...noReply, minutes: parseInt(e.target.value) || 0 })} className="w-20 px-2 py-1 rounded border border-[--input] bg-[--background] text-right" />
          <span>minutos sem resposta, enviar:</span>
        </div>
        <textarea value={noReply.message ?? ''} onChange={(e) => setNoReply({ ...noReply, message: e.target.value })} rows={2} placeholder="Mensagem de follow-up (ex: Vi que você não respondeu...)" className="w-full px-2 py-1.5 rounded border border-[--input] bg-[--background] text-sm outline-none" />
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span>E se ainda assim não responder, mover para:</span>
          <select value={noReply.targetStageName ?? ''} onChange={(e) => setNoReply({ ...noReply, targetStageName: e.target.value })} className="px-2 py-1 rounded border border-[--input] bg-[--background]">
            <option value="">— nenhuma —</option>
            {allStages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-[--muted-foreground]">O tempo conta após cada pergunta. Manda a mensagem 1x; se continuar sem resposta no mesmo tempo, move de etapa.</p>
      </div>
    </div>
  )
}
