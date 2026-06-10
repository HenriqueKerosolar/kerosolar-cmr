import 'server-only'

/**
 * 💳 Simulação de CARTÃO DE CRÉDITO (tabela PinPag).
 * A coluna "Taxa Acumulada" é o % TOTAL sobre o valor:
 *   total   = valor × (1 + acumulada/100)
 *   parcela = total / nº de parcelas
 * Reproduz a tabela oficial (referência R$ 1.000,00) e escala pra qualquer valor.
 * "taxa" (% a.m.) é só exibição. Máximo 24x.
 */
export const MAX_PARCELAS_CARTAO = 24

export const TABELA_CARTAO: Record<number, { taxa: number; acumulada: number }> = {
  1:  { taxa: 4.10, acumulada: 4.10 },
  2:  { taxa: 3.55, acumulada: 5.36 },
  3:  { taxa: 3.10, acumulada: 6.26 },
  4:  { taxa: 2.90, acumulada: 7.35 },
  5:  { taxa: 2.80, acumulada: 8.55 },
  6:  { taxa: 2.77, acumulada: 9.92 },
  7:  { taxa: 2.77, acumulada: 11.38 },
  8:  { taxa: 2.77, acumulada: 12.86 },
  9:  { taxa: 2.60, acumulada: 13.44 },
  10: { taxa: 2.55, acumulada: 14.55 },
  11: { taxa: 2.60, acumulada: 16.27 },
  12: { taxa: 2.46, acumulada: 16.70 },
  13: { taxa: 2.77, acumulada: 20.45 },
  14: { taxa: 2.78, acumulada: 22.09 },
  15: { taxa: 2.79, acumulada: 23.75 },
  16: { taxa: 2.85, acumulada: 25.92 },
  17: { taxa: 2.77, acumulada: 26.74 },
  18: { taxa: 2.39, acumulada: 24.22 },
  19: { taxa: 2.75, acumulada: 29.73 },
  20: { taxa: 2.77, acumulada: 31.59 },
  21: { taxa: 2.35, acumulada: 27.84 },
  22: { taxa: 2.35, acumulada: 29.21 },
  23: { taxa: 2.35, acumulada: 30.59 },
  24: { taxa: 2.35, acumulada: 31.98 },
}

export type CartaoResult = { parcelas: number; taxa: number; acumulada: number; total: number; parcela: number }

/** Simula o parcelamento no cartão para um valor e nº de parcelas (1–24). */
export function simularCartao(valor: number, parcelas: number): CartaoResult | null {
  const row = TABELA_CARTAO[parcelas]
  if (!row || valor <= 0) return null
  const total = valor * (1 + row.acumulada / 100)
  return {
    parcelas,
    taxa: row.taxa,
    acumulada: row.acumulada,
    total: Math.round(total * 100) / 100,
    parcela: Math.round((total / parcelas) * 100) / 100,
  }
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Mensagem (WhatsApp) da simulação no cartão. `valorSistema` é o valor cheio; `entrada`
 *  (opcional) é deduzida — as parcelas em `sim` já devem ser do valor financiado (sistema − entrada). */
export function formatarCartao(sim: CartaoResult, valorSistema: number, entrada = 0): string {
  const head = entrada > 0
    ? `🔆 Sistema: ${brl(valorSistema)}\n💵 Entrada: *${brl(entrada)}*\n💳 No cartão: *${brl(valorSistema - entrada)}*`
    : `🔆 Sistema: *${brl(valorSistema)}*`
  return (
`💳 *PAGAMENTO NO CARTÃO DE CRÉDITO*

${head}
*${sim.parcelas}x de ${brl(sim.parcela)}*
Total no cartão: ${brl(sim.total)}

_Simulação — as taxas e valores podem ser atualizados a qualquer momento._`
  )
}

const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Detecta pedido de simulação no CARTÃO e o nº de parcelas, se informado. */
export function extrairCartao(text: string): { intent: boolean; parcelas: number | null } {
  const t = norm(text)
  const intent = /\bcart[ao]+\b|cartao|no credito|pagar no credito/.test(t)
  let parcelas: number | null = null
  const m = t.match(/(\d{1,2})\s*(x|vezes|vez|parcelas?|meses|mes)\b/) || t.match(/\bem\s+(\d{1,2})\b/)
  if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 99) parcelas = n }
  return { intent, parcelas }
}
