import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * 🩺 Monitor de "mensagens de entrada" (dead-man's switch).
 *
 * Roda DENTRO do processo do servidor (via instrumentation → startInboundMonitor).
 * A cada ~15 min verifica a última mensagem de ENTRADA (cliente). Se não chegar
 * nenhuma por X horas DURANTE o horário comercial, avisa o dono no WhatsApp
 * (notificarDono). Pega qualquer causa de apagão: webhook caído, App Secret
 * errado, deploy quebrado, Supabase pausado, etc. — em horas, não em dias.
 *
 * Como o envio (saída) continua funcionando mesmo quando a ENTRADA está quebrada,
 * o alerta chega normalmente pela própria Cloud API.
 *
 * Ajustável por SystemConfig (sem redeploy):
 *   - monitor_threshold_hours  (padrão 4)  → horas sem entrada p/ alertar
 *   - monitor_realert_hours    (padrão 6)  → não repete o alerta antes disso
 *   - monitor_enabled = "0"               → desliga o monitor
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000 // verifica a cada 15 min
const DEFAULT_THRESHOLD_HOURS = 4
const DEFAULT_REALERT_HOURS = 6
const SP_OFFSET_MS = -3 * 60 * 60 * 1000 // Brasília UTC-3 (sem horário de verão)

/** Só alerta entre 8h e 20h (Brasília) — evita alarme de madrugada sem movimento. */
function dentroHorarioAlerta(now: Date): boolean {
  const h = new Date(now.getTime() + SP_OFFSET_MS).getUTCHours()
  return h >= 8 && h < 20
}

async function numConfig(key: string, fallback: number): Promise<number> {
  const c = await prisma.systemConfig.findUnique({ where: { key } })
  const n = c?.value ? Number(c.value) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function checkInboundHealth(): Promise<void> {
  try {
    const now = new Date()
    if (!dentroHorarioAlerta(now)) return

    const desligado = await prisma.systemConfig.findUnique({ where: { key: 'monitor_enabled' } })
    if (desligado?.value === '0') return

    const thresholdH = await numConfig('monitor_threshold_hours', DEFAULT_THRESHOLD_HOURS)
    const realertH = await numConfig('monitor_realert_hours', DEFAULT_REALERT_HOURS)

    const lastInbound = await prisma.message.findFirst({
      where: { direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const lastAt = lastInbound?.createdAt ?? null
    const horasSem = lastAt ? (now.getTime() - lastAt.getTime()) / 36e5 : Infinity
    if (horasSem < thresholdH) return

    // Não repete o alerta antes de realertH horas.
    const last = await prisma.systemConfig.findUnique({ where: { key: 'monitor_last_alert_at' } })
    if (last?.value) {
      const horasDesdeAlerta = (now.getTime() - new Date(last.value).getTime()) / 36e5
      if (Number.isFinite(horasDesdeAlerta) && horasDesdeAlerta < realertH) return
    }

    const quando = lastAt ? `há ${Math.floor(horasSem)}h` : 'sem registro recente'
    const { notificarDono } = await import('./flow')
    await notificarDono(
      `⚠️ *ALERTA — CRM sem mensagens de entrada*\n\n` +
        `Nenhuma mensagem de cliente chegou nas últimas ${Math.floor(horasSem)}h (última: ${quando}).\n\n` +
        `Possíveis causas: webhook do WhatsApp caído, App Secret errado, deploy quebrado ou Supabase pausado. ` +
        `Confira o CRM e o Railway.`,
    )

    await prisma.systemConfig.upsert({
      where: { key: 'monitor_last_alert_at' },
      update: { value: now.toISOString() },
      create: { key: 'monitor_last_alert_at', value: now.toISOString() },
    })
    console.log('[monitor-inbox] alerta enviado — %dh sem entrada', Math.floor(horasSem))
  } catch (e) {
    console.error('[monitor-inbox]', e)
  }
}

/** Inicia o monitor (idempotente). Chamado pelo instrumentation no boot do servidor. */
export function startInboundMonitor(): void {
  const g = globalThis as unknown as { __inboxMonitor?: NodeJS.Timeout }
  if (g.__inboxMonitor) return
  // primeira verificação 2 min após o boot, depois a cada 15 min
  setTimeout(() => void checkInboundHealth(), 2 * 60 * 1000)
  g.__inboxMonitor = setInterval(() => void checkInboundHealth(), CHECK_INTERVAL_MS)
}
