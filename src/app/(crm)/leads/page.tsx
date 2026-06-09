import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ensureDefaultPipeline } from '@/lib/crm/engine'
import Link from 'next/link'
import { BroadcastButton } from './broadcast-button'
import { NewLeadButton } from './new-lead-button'
import { ImportButton } from './import-button'
import { ExportButton } from './export-button'

export const dynamic = 'force-dynamic'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ funil?: string }> }) {
  await verifySession()
  await ensureDefaultPipeline()

  const { funil } = await searchParams
  const pipelines = await prisma.pipeline.findMany({ orderBy: { sortOrder: 'asc' } })
  const current = pipelines.find((p) => p.id === funil) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0]

  const stages = await prisma.stage.findMany({
    where: { pipelineId: current.id },
    orderBy: { sortOrder: 'asc' },
    include: {
      leads: {
        where: { status: 'open' },
        orderBy: [{ highPriority: 'desc' }, { lastMessageAt: 'desc' }],
        include: { contact: true },
      },
    },
  })

  const totalLeads = stages.reduce((s, st) => s + st.leads.length, 0)

  return (
    <div className="p-4 md:p-6 h-full flex flex-col gap-4">
      {/* Switcher de funis */}
      <div className="flex items-center gap-2 flex-wrap">
        {pipelines.map((p) => (
          <Link key={p.id} href={`/leads?funil=${p.id}`}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition ${p.id === current.id ? 'bg-[--primary] text-[--primary-foreground]' : 'border border-[--border] hover:bg-[--accent]'}`}>
            <span>{p.icon ?? '📁'}</span> {p.name}
          </Link>
        ))}
        <Link href="/funis" className="px-3 py-1.5 rounded-lg text-sm border border-dashed border-[--border] text-[--muted-foreground] hover:bg-[--accent]">+ Gerenciar</Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{current.icon} {current.name}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[--muted-foreground]">{totalLeads} leads abertos</span>
          <ImportButton pipelineId={current.id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
          <NewLeadButton pipelineId={current.id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
          <BroadcastButton stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
          <ExportButton stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
        {stages.map((stage) => (
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
                const nome = (lead.contact?.name || lead.title || '?').trim()
                const ini = nome.replace(/[^A-Za-zÀ-ÿ0-9]/g, '')[0]?.toUpperCase() ?? '?'
                return (
                  <Link key={lead.id} href={`/leads/${lead.id}`}
                    className="p-3 rounded-xl border border-[--border] bg-white dark:bg-zinc-900 hover:shadow-md hover:border-[--ring]/50 transition block">
                    <div className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: stage.color ?? '#8898aa' }}>{ini}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate leading-tight">{lead.highPriority && <span title="Prioridade">⚡ </span>}{nome}</p>
                        {lead.contact?.phone && <p className="text-[11px] text-[--muted-foreground] truncate">{lead.contact.phone}</p>}
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
                <div className="border-2 border-dashed border-[--border] rounded-xl p-5 text-center text-xs text-[--muted-foreground]">Nenhum lead</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
