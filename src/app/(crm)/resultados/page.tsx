import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ResultadosPage() {
  await verifySession()
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // últimos 30 dias

  const [
    filaDisparo,
    enviados,
    visualizados,
    respondidosRows,
    ganhos,
    perdidos,
    abertos,
    pipeline,
  ] = await Promise.all([
    prisma.scheduledAction.count({ where: { type: 'send_message', done: false } }),
    prisma.message.count({ where: { direction: 'outbound', createdAt: { gte: desde } } }),
    prisma.message.count({ where: { direction: 'outbound', readAt: { not: null }, createdAt: { gte: desde } } }),
    prisma.message.findMany({ where: { direction: 'inbound', createdAt: { gte: desde } }, distinct: ['conversationId'], select: { conversationId: true } }),
    prisma.lead.count({ where: { status: 'won' } }),
    prisma.lead.count({ where: { status: 'lost' } }),
    prisma.lead.count({ where: { status: 'open' } }),
    prisma.pipeline.findFirst({ orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { leads: true } } } } } }),
  ])
  const respondidos = respondidosRows.length

  const pct = (n: number, base: number) => base > 0 ? Math.round((n / base) * 100) : 0

  const card = (titulo: string, valor: string | number, sub?: string, cor = '') => (
    <div className="rounded-2xl border border-[--border] bg-[--card] p-4">
      <p className="text-xs text-[--muted-foreground]">{titulo}</p>
      <p className={`text-2xl font-bold mt-1 ${cor}`}>{valor}</p>
      {sub && <p className="text-[11px] text-[--muted-foreground] mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">📊 Resultados</h1>
        <p className="text-sm text-[--muted-foreground] mt-1">Eficiência dos atendimentos e disparos — últimos 30 dias.</p>
      </div>

      {/* Fila */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {card('📤 Disparos na fila', filaDisparo, 'mensagens aguardando envio')}
        {card('🟢 Leads abertos', abertos, 'em atendimento')}
        {card('🏆 Ganhos', ganhos, 'fechados (won)', 'text-green-600')}
        {card('🔴 Perdidos', perdidos, 'sem interesse / lost', 'text-red-500')}
      </div>

      {/* Funil de eficiência */}
      <div>
        <h2 className="font-semibold text-sm mb-2">Funil de eficiência (30 dias)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {card('Enviados', enviados, 'mensagens que enviamos')}
          {card('Visualizados', visualizados, `${pct(visualizados, enviados)}% dos enviados (✓✓ azul)`)}
          {card('Responderam', respondidos, 'clientes que responderam')}
          {card('Ganhos', ganhos, 'viraram cliente')}
        </div>
        <p className="text-[11px] text-[--muted-foreground] mt-2">
          ⚠️ &quot;Visualizados&quot; conta a partir de agora (depende do cliente ter o recibo de leitura ✓✓ ligado). Mensagens antigas não têm esse dado.
        </p>
      </div>

      {/* Por etapa */}
      <div>
        <h2 className="font-semibold text-sm mb-2">Leads por etapa</h2>
        <div className="rounded-2xl border border-[--border] bg-[--card] divide-y divide-[--border]">
          {pipeline?.stages.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{s.name}</span>
              <span className="font-semibold">{s._count.leads}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
