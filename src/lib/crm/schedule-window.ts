import 'server-only'

/**
 * Janela de envio das mensagens automáticas.
 * - Mensagens de bot agendadas: dias úteis (seg–sex), 9h–18h.
 * - Regra global: nada é enviado após 21h nem antes das 9h.
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
export const HARD_END_HOUR = 21   // nada depois das 21h (regra global)
export const HARD_START_HOUR = 9  // nada antes das 9h

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
  const s = typeof startHour === 'number' ? Math.max(0, Math.min(23, startHour)) : JANELA_PADRAO.startHour
  const e = typeof endHour === 'number' ? Math.max(s + 1, Math.min(23, endHour)) : JANELA_PADRAO.endHour
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

/** Regra global: nada após 21h / antes das 9h. Empurra pro próximo horário válido. */
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
