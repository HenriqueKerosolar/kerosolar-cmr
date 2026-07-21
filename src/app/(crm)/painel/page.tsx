import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function inicioDeHojeBR(): Date {
  const agora = new Date()
  const br = new Date(agora.getTime() - 3 * 3600000)
  br.setUTCHours(0, 0, 0, 0)
  return new Date(br.getTime() + 3 * 3600000)
}
function horaBR(d: Date) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

export default async function PainelPage() {
  await verifySession()
  const hoje = inicioDeHojeBR()
  const desde30 = new Date(Date.now() - 30 * 86400000)

  const [
    abertos, novosHoje, emAtendimento, ganhos, perdidos, filaDisparo, msgsHoje,
    proximos, tarefas, pipeline, enviados, visualizados, respRows,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: 'open' } }),
    prisma.lead.count({ where: { createdAt: { gte: hoje } } }),
    prisma.lead.count({ where: { status: 'open', aiEnabled: false } }),
    prisma.lead.count({ where: { status: 'won' } }),
    prisma.lead.count({ where: { status: 'lost' } }),
    prisma.scheduledAction.count({ where: { type: 'send_message', done: false } }),
    prisma.message.count({ where: { createdAt: { gte: hoje } } }),
    prisma.appointment.findMany({ where: { status: 'scheduled', scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 5, include: { lead: { include: { contact: true } } } }),
    prisma.task.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 6, include: { lead: { include: { contact: true } } } }),
    prisma.pipeline.findFirst({ orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { leads: true } } } } } }),
    prisma.message.count({ where: { direction: 'outbound', createdAt: { gte: desde30 } } }),
    prisma.message.count({ where: { direction: 'outbound', readAt: { not: null }, createdAt: { gte: desde30 } } }),
    prisma.message.findMany({ where: { direction: 'inbound', createdAt: { gte: desde30 } }, distinct: ['conversationId'], select: { conversationId: true } }),
  ])
  const responderam = respRows.length
  const maxEtapa = Math.max(1, ...(pipeline?.stages.map((s) => s._count.leads) ?? [1]))
  const pct = (n: number, b: number) => b > 0 ? Math.round((n / b) * 100) : 0

  const Stat = ({ icon, label, valor, cor, href }: { icon: string; label: string; valor: number; cor?: string; href?: string }) => {
    const body = (
      <div className="rounded-2xl border border-[--border] bg-white dark:bg-zinc-900 p-4 h-full hover:shadow-md transition">
        <div className="flex items-center gap-2"><span className="text-xl">{icon}</span><span className="text-xs text-[--muted-foreground]">{label}</span></div>
        <p className={`text-3xl font-bold mt-1 ${cor ?? ''}`}>{valor}</p>
      </div>
    )
    return href ? <Link href={href}>{body}</Link> : body
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">🏠 Painel de controle</h1>
        <p className="text-sm text-[--muted-foreground] mt-1">Visão geral do seu CRM — tudo num lugar só.</p>
      </div>

      {/* Números principais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat icon="🟢" label="Leads abertos" valor={abertos} href="/leads" />
        <Stat icon="✨" label="Novos hoje" valor={novosHoje} cor="text-amber-500" href="/inbox?novos=1" />
        <Stat icon="👤" label="Em atendimento humano" valor={emAtendimento} href="/inbox" />
        <Stat icon="🏆" label="Ganhos" valor={ganhos} cor="text-green-600" />
        <Stat icon="📤" label="Disparos na fila" valor={filaDisparo} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Funil */}
        <div className="rounded-2xl border border-[--border] bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-sm">📊 Leads por etapa</h2><Link href="/leads" className="text-xs text-[--primary] hover:underline">ver funil →</Link></div>
          <div className="space-y-2">
            {pipeline?.stages.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span className="w-44 truncate shrink-0">{s.name}</span>
                <div className="flex-1 h-4 rounded bg-[--muted]/40 overflow-hidden">
                  <div className="h-full rounded bg-[--primary]" style={{ width: `${Math.round((s._count.leads / maxEtapa) * 100)}%`, minWidth: s._count.leads ? '6px' : '0' }} />
                </div>
                <span className="w-7 text-right font-semibold shrink-0">{s._count.leads}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna direita: agenda + tarefas */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-[--border] bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-sm">📅 Próximos agendamentos</h2><Link href="/agenda" className="text-xs text-[--primary] hover:underline">agenda →</Link></div>
            <div className="divide-y divide-[--border]">
              {proximos.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="truncate">{a.lead.contact?.name ?? a.lead.title}</span>
                  <span className="text-xs text-[--muted-foreground] shrink-0">{horaBR(a.scheduledAt)}</span>
                </div>
              ))}
              {proximos.length === 0 && <p className="text-sm text-[--muted-foreground] py-2">Nenhum agendamento próximo.</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-[--border] bg-white dark:bg-zinc-900 p-4">
            <h2 className="font-semibold text-sm mb-2">✅ Tarefas pendentes</h2>
            <div className="divide-y divide-[--border]">
              {tarefas.map((t) => (
                <div key={t.id} className="py-1.5 text-sm">
                  <Link href={`/leads/${t.leadId ?? ''}`} className="hover:underline">{t.title}</Link>
                </div>
              ))}
              {tarefas.length === 0 && <p className="text-sm text-[--muted-foreground] py-2">Nenhuma tarefa pendente. 🎉</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Eficiência 30 dias */}
      <div className="rounded-2xl border border-[--border] bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-sm">📈 Eficiência (últimos 30 dias)</h2><Link href="/resultados" className="text-xs text-[--primary] hover:underline">resultados →</Link></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Enviadas', enviados, ''],
            ['Visualizadas', visualizados, `${pct(visualizados, enviados)}%`],
            ['Responderam', responderam, ''],
            ['Mensagens hoje', msgsHoje, ''],
          ].map(([l, v, sub]) => (
            <div key={l as string} className="rounded-xl bg-[--muted]/30 p-3">
              <p className="text-xs text-[--muted-foreground]">{l}</p>
              <p className="text-2xl font-bold mt-0.5">{v as number} {sub ? <span className="text-sm font-normal text-[--muted-foreground]">· {sub}</span> : null}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Atalhos */}
      <div className="flex flex-wrap gap-2">
        {[['/leads', '🏆 Leads'], ['/inbox', '💬 Inbox'], ['/agenda', '📅 Agenda'], ['/resultados', '📊 Resultados'], ['/listas', '🚫 Listas']].map(([h, l]) => (
          <Link key={h} href={h} className="px-3 py-1.5 rounded-lg border border-[--border] bg-white dark:bg-zinc-900 text-sm hover:shadow-sm transition">{l}</Link>
        ))}
      </div>
    </div>
  )
}
