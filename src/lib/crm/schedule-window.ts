import 'server-only'

/**
 * Janela de envio das mensagens automáticas.
 * - Mensagens de bot agendadas: dias úteis (seg–sex), 9h–18h.
 * - Regra global (dono, 2026-11-09): NENHUMA mensagem automática antes das 8h nem a partir das 19h.
 * - Espaçamento "humano" entre mensagens (simula digitação), determinístico.
 *
 * Brasil não tem horário de verão desde 2019 → fuso fixo UTC−3.
 */

const SP_OFFSET_MS = -3 * 60 * 60 * 1000

export const JANELA_PADRAO = {
  startHour: 9,
  endHour: 18,        // mensagens de bot agendadas: 9–18
  businessOnly: true, // só dias úteis
}
export const HARD_END_HOUR = 19   // nada a partir das 19h (regra global do dono)
export const HARD_START_HOUR = 8  // nada antes das 8h (regra global do dono)

/** Componentes de data no fuso de Brasília. */
function spParts(d: Date) {
  const sp = new Date(d.getTime() + SP_OFFSET_MS)
  return { day: sp.getUTCDay(), hour: sp.getUTCHours(), date: sp } // day: 0=dom..6=sáb
}

/** Constrói um instante real a partir de uma data SP + hora cheia. */
function spDateAtHour(spDate: Date, hour: number): Date {
  const d = new Date(spDate)
  d.setUTCHours(hour, 0, 0, 0)
  return new Date(d.getTime() - SP_OFFSET_MS)
}

export type Janela = { startHour: number; endHour: number; businessOnly: boolean }

/** Monta a janela a partir das horas configuradas no funil (com limites sãos). */
export function janelaDoFunil(startHour?: number | null, endHour?: number | null): Janela {
  // o funil pode ser MAIS restrito, nunca mais largo que a regra global (8h–19h)
  const s = typeof startHour === 'number' ? Math.max(HARD_START_HOUR, Math.min(HARD_END_HOUR - 1, startHour)) : JANELA_PADRAO.startHour
  const e = typeof endHour === 'number' ? Math.max(s + 1, Math.min(HARD_END_HOUR, endHour)) : JANELA_PADRAO.endHour
  return { startHour: s, endHour: e, businessOnly: true }
}

/**
 * Retorna o próximo instante permitido (>= after) dentro da janela.
 * Se já estiver dentro, devolve o próprio `after`.
 */
export function nextAllowedSlot(after: Date, janela: Janela = JANELA_PADRAO): Date {
  let t = new Date(after)
  for (let i = 0; i < 30; i++) { // no máx ~30 saltos (semanas)
    const { day, hour, date } = spParts(t)
    const isBusiness = !janela.businessOnly || (day >= 1 && day <= 5)
    if (isBusiness && hour >= janela.startHour && hour < janela.endHour) return t

    // fora da janela → avança pro próximo início válido
    if (isBusiness && hour < janela.startHour) {
      t = spDateAtHour(date, janela.startHour)           // hoje, na abertura
    } else {
      // depois do fim (ou fim de semana) → abertura do próximo dia
      const next = new Date(date.getTime() + 24 * 60 * 60 * 1000)
      t = spDateAtHour(next, janela.startHour)
    }
  }
  return t
}

/** Regra global: nada a partir das 19h / antes das 8h. Empurra pro próximo horário válido. */
export function respeitaHorarioGlobal(after: Date): Date {
  const { hour, date } = spParts(after)
  if (hour >= HARD_END_HOUR) {
    const next = new Date(date.getTime() + 24 * 60 * 60 * 1000)
    return spDateAtHour(next, HARD_START_HOUR)
  }
  if (hour < HARD_START_HOUR) return spDateAtHour(date, HARD_START_HOUR)
  return after
}

/**
 * Espaçamento "humano" pra uma mensagem (ms): simula tempo de digitação.
 * Determinístico (não aleatório): base + tempo proporcional ao tamanho do texto.
 */
export function tempoDigitacaoMs(text: string): number {
  const base = 4000                       // 4s de "lendo/pensando"
  const porChar = 45                      // ~22 caracteres/seg
  return base + Math.min(text.length, 600) * porChar  // teto ~31s
}

/** Agora (horário de Brasília) está dentro da regra global 8h–19h? */
export function dentroHorarioGlobal(d: Date = new Date()): boolean {
  const { hour } = spParts(d)
  return hour >= HARD_START_HOUR && hour < HARD_END_HOUR
}

/** Feriados nacionais fixos (MM-DD) — mesmos que a IA usa para falar de dias úteis. */
export const FERIADOS_FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']

/** A data (no fuso de Brasília) é DIA ÚTIL? (seg–sex e não é feriado nacional fixo) */
export function ehDiaUtil(d: Date): boolean {
  const { day, date } = spParts(d)
  if (day === 0 || day === 6) return false
  const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  return !FERIADOS_FIXOS.includes(mmdd)
}
