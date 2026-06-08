'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updateAppointmentStatus } from '@/app/actions/appointment'

type Appt = {
  id: string
  title: string
  scheduledAt: string
  channel: string
  status: string
  notes: string | null
  remindedAt: string | null
  leadId: string
  leadTitle: string
  contactName: string | null
  contactPhone: string | null
  stageName: string
  stageColor: string | null
}

const CHANNEL_ICON: Record<string, string> = { whatsapp: '💬', phone: '📞', video: '🎥', visit: '🏠' }
const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', phone: 'Ligação', video: 'Videochamada', visit: 'Visita técnica' }
const STATUS_LABEL: Record<string, string> = { scheduled: 'Agendado', done: 'Realizado', cancelled: 'Cancelado' }
const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isToday(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) === now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function isPast(iso: string) {
  return new Date(iso) < new Date()
}

function groupByDay(appts: Appt[]) {
  const groups: Record<string, Appt[]> = {}
  for (const a of appts) {
    const key = new Date(a.scheduledAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
}

export function AgendaClient({ appointments: initial }: { appointments: Appt[] }) {
  const router = useRouter()
  const [appts, setAppts] = useState(initial)
  const [, startTransition] = useTransition()

  function changeStatus(id: string, status: string) {
    setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a))
    startTransition(async () => {
      await updateAppointmentStatus(id, status)
      router.refresh()
    })
  }

  const upcoming = appts.filter(a => a.status === 'scheduled')
  const past = appts.filter(a => a.status !== 'scheduled')
  const groups = groupByDay(upcoming)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">📅 Agenda</h1>
          <p className="text-sm text-[--muted-foreground]">Consultorias agendadas pelos clientes</p>
        </div>
        <span className="text-sm font-medium px-3 py-1 rounded-full bg-[--muted]">
          {upcoming.length} agendamento{upcoming.length !== 1 ? 's' : ''}
        </span>
      </div>

      {upcoming.length === 0 && (
        <div className="text-center py-16 text-[--muted-foreground]">
          <p className="text-3xl mb-2">📭</p>
          <p>Nenhum agendamento próximo.</p>
        </div>
      )}

      {Object.entries(groups).map(([day, dayAppts]) => (
        <div key={day}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              isToday(dayAppts[0].scheduledAt)
                ? 'bg-[--primary] text-[--primary-foreground]'
                : 'bg-[--muted] text-[--muted-foreground]'
            }`}>
              {isToday(dayAppts[0].scheduledAt) ? '🟢 Hoje' : day}
            </span>
            <div className="flex-1 h-px bg-[--border]" />
          </div>

          <div className="space-y-3">
            {dayAppts.map(a => {
              const overdue = isPast(a.scheduledAt) && a.status === 'scheduled'
              return (
                <div key={a.id} className={`rounded-xl border p-4 ${overdue ? 'border-amber-300 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/10' : 'border-[--border] bg-[--card]'}`}>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl mt-0.5">{CHANNEL_ICON[a.channel] ?? '📅'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.contactName ?? a.leadTitle}</span>
                        {a.contactPhone && <span className="text-xs text-[--muted-foreground]">{a.contactPhone}</span>}
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status]}`}>
                          {STATUS_LABEL[a.status]}
                        </span>
                        {overdue && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">⏰ Passou do horário</span>}
                        {a.remindedAt && <span className="text-[11px] text-[--muted-foreground]">🔔 Lembrado</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-[--muted-foreground]">
                        <span>🕐 {fmtDate(a.scheduledAt)}</span>
                        <span>{CHANNEL_LABEL[a.channel] ?? a.channel}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 rounded-full border border-[--border]"
                          style={a.stageColor ? { borderColor: a.stageColor, color: a.stageColor } : {}}>
                          {a.stageName}
                        </span>
                        {a.notes && <span className="text-xs text-[--muted-foreground] italic truncate max-w-xs">{a.notes}</span>}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 shrink-0">
                      <Link href={`/leads/${a.leadId}`}
                        className="text-xs px-2 py-1 rounded-lg border border-[--border] hover:bg-[--accent] text-center">
                        Ver lead
                      </Link>
                      {a.status === 'scheduled' && (
                        <>
                          <button onClick={() => changeStatus(a.id, 'done')}
                            className="text-xs px-2 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700">
                            ✓ Realizado
                          </button>
                          <button onClick={() => changeStatus(a.id, 'cancelled')}
                            className="text-xs px-2 py-1 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20">
                            Cancelar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {past.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-[--muted-foreground] hover:text-[--foreground] select-none">
            Histórico ({past.length} realizados/cancelados)
          </summary>
          <div className="mt-3 space-y-2">
            {past.map(a => (
              <div key={a.id} className="rounded-xl border border-[--border] bg-[--card] p-3 opacity-60 flex items-center gap-3">
                <span>{CHANNEL_ICON[a.channel] ?? '📅'}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{a.contactName ?? a.leadTitle}</span>
                  <span className="text-xs text-[--muted-foreground] ml-2">{fmtDate(a.scheduledAt)}</span>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
                <Link href={`/leads/${a.leadId}`} className="text-xs text-[--muted-foreground] hover:underline">ver</Link>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
