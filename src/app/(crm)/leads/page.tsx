import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ensureDefaultPipeline } from '@/lib/crm/engine'
import Link from 'next/link'
import { BroadcastButton } from './broadcast-button'
import { NewLeadButton } from './new-lead-button'
import { ImportButton } from './import-button'
import { ExportButton } from './export-button'
import { LeadsBoard } from './leads-board'

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

  // Dados serializáveis para o quadro (componente cliente com busca instantânea).
  const boardStages = stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    leads: s.leads.map((l) => ({
      id: l.id,
      name: (l.contact?.name || l.title || '?').trim(),
      phone: l.contact?.phone ?? null,
      source: l.source,
      value: l.value,
      highPriority: l.highPriority,
      aiEnabled: l.aiEnabled,
      createdAt: l.createdAt.toISOString(),
    })),
  }))

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

      {/* Localizador + Kanban (cliente: busca instantânea por nome ou telefone) */}
      <LeadsBoard stages={boardStages} />
    </div>
  )
}
