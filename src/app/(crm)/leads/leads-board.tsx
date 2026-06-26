'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type Lead = {
  id: string
  name: string
  phone: string | null
  source: string | null
  value: number
  highPriority: boolean
  aiEnabled: boolean
  createdAt: string
}
type Stage = { id: string; name: string; color: string | null; leads: Lead[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const digits = (s: string) => s.replace(/\D/g, '')

export function LeadsBoard({ stages }: { stages: Stage[] }) {
  const [q, setQ] = useState('')

  const termo = norm(q)
  const termoNum = digits(q)
  const filtrar = (lead: Lead) => {
    if (!termo) return true
    const nomeOk = norm(lead.name).includes(termo)
    const telOk = termoNum.length > 0 && lead.phone ? digits(lead.phone).includes(termoNum) : false
    return nomeOk || telOk
  }

  const stagesFiltrados = stages.map((s) => ({ ...s, leads: q ? s.leads.filter(filtrar) : s.leads }))
  const totalEncontrado = stagesFiltrados.reduce((n, s) => n + s.leads.length, 0)

  return (
    <>
      {/* Localizador */}
      <div className="relative max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[--muted-foreground] text-sm">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar lead por nome ou telefone…"
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
        />
        {q && (
          <button onClick={() => setQ('')} title="Limpar"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 text-[--muted-foreground] hover:text-[--foreground]">✕</button>
        )}
      </div>
      {q && <p className="text-xs text-[--muted-foreground] -mt-1">{totalEncontrado} resultado(s) para “{q}”.</p>}

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
        {stagesFiltrados.map((stage) => (
          <div key={stage.id} className="shrink-0 w-72 flex flex-col gap-2.5">
            {/* Cabeçalho da etapa */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[--muted]/50 border border-[--border]">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: stage.color ?? '#8898aa' }} />
              <span className="font-semibold text-sm truncate">{stage.name}</span>
              <span className="ml-auto text-xs font-bold text-[--muted-foreground] bg-white dark:bg-zinc-900 border border-[--border] rounded-full px-2 py-0.5 shrink-0">{stage.leads.length}</span>
            </div>
            {/* Cards */}
            <div className="flex flex-col gap-2.5">
              {stage.leads.map((lead) => {
                const nome = (lead.name || '?').trim()
                const ini = nome.replace(/[^A-Za-zÀ-ÿ0-9]/g, '')[0]?.toUpperCase() ?? '?'
                const isNew = (Date.now() - new Date(lead.createdAt).getTime()) < 3 * 24 * 60 * 60 * 1000
                return (
                  <Link key={lead.id} href={`/leads/${lead.id}`}
                    className={`p-3 rounded-xl border bg-white dark:bg-zinc-900 hover:shadow-md transition block ${isNew ? 'border-blue-400 dark:border-blue-500' : 'border-[--border] hover:border-[--ring]/50'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: stage.color ?? '#8898aa' }}>{ini}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-sm truncate leading-tight">{lead.highPriority && <span title="Prioridade">⚡ </span>}{nome}</p>
                          {isNew && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 uppercase tracking-wide">Novo</span>}
                        </div>
                        {lead.phone && <p className="text-[11px] text-[--muted-foreground] truncate">{lead.phone}</p>}
                      </div>
                    </div>
                    {(lead.source || !lead.aiEnabled || lead.value > 0) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {lead.source && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[--muted]/60 text-[--muted-foreground]">
                            {lead.source === 'whatsapp' ? '🟢' : lead.source === 'instagram' ? '📷' : lead.source === 'facebook' ? '💬' : '🧪'} {lead.source}
                          </span>
                        )}
                        {!lead.aiEnabled && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">👤 humano</span>}
                        {lead.value > 0 && <span className="ml-auto text-[11px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-full px-2 py-0.5">{lead.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</span>}
                      </div>
                    )}
                  </Link>
                )
              })}
              {stage.leads.length === 0 && (
                <div className="border-2 border-dashed border-[--border] rounded-xl p-5 text-center text-xs text-[--muted-foreground]">
                  {q ? 'Nenhum resultado' : 'Nenhum lead'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
