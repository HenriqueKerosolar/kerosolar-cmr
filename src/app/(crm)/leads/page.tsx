import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ensureDefaultPipeline } from '@/lib/crm/engine'
import Link from 'next/link'
import { BroadcastButton } from './broadcast-button'
import { NewLeadButton } from './new-lead-button'
import { ImportButton } from './import-button'

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
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
        {stages.map((stage) => (
          <div key={stage.id} className="shrink-0 w-64 flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color ?? '#888' }} />
              <span className="font-medium text-sm">{stage.name}</span>
              <span className="ml-auto text-xs text-[--muted-foreground] bg-[--muted] rounded-full px-1.5 py-0.5">{stage.leads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {stage.leads.map((lead) => (
                <Link key={lead.id} href={`/leads/${lead.id}`}
                  className="p-3 rounded-xl border border-[--border] bg-[--card] hover:shadow-sm transition block space-y-1.5">
                  <p className="font-medium text-sm truncate">{lead.highPriority && '⚡ '}{lead.title}</p>
                  {lead.contact?.phone && <p className="text-xs text-[--muted-foreground]">{lead.contact.phone}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {lead.source && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-[--border] bg-[--muted]/40">
                        {lead.source === 'whatsapp' ? '🟢' : lead.source === 'instagram' ? '📷' : lead.source === 'facebook' ? '💬' : '🧪'} {lead.source}
                      </span>
                    )}
                    {!lead.aiEnabled && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">👤 humano</span>}
                  </div>
                  {lead.value > 0 && <p className="text-xs font-semibold text-green-600">{lead.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
                </Link>
              ))}
              {stage.leads.length === 0 && (
                <div className="border-2 border-dashed border-[--border] rounded-xl p-4 text-center text-xs text-[--muted-foreground]">Nenhum lead</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
