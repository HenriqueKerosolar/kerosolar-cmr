import 'server-only'

/**
 * Cálculo de consumo de ar-condicionado para acrescentar à conta.
 * Fator: cada 1000 BTU = 1,94 kWh/mês para cada 1 hora/dia de uso.
 * kWh/mês = (BTU/1000) × 1,94 × horas_por_dia × quantidade
 *
 * Quando a TABELA de consumo for fornecida, usar a tabela; se o BTU informado
 * não estiver na tabela, usar a linha imediatamente ABAIXO (BTU menor).
 */

export const FATOR_AC = 1.94 // kWh/mês por (1000 BTU × 1h/dia)

// BTUs comuns (tabela base; será refinada quando a tabela oficial chegar)
const BTUS_TABELA = [7000, 9000, 12000, 18000, 24000, 30000, 36000, 48000, 60000]

/** Ajusta o BTU pro valor da tabela: se não existir, pega o ABAIXO do informado. */
export function btuDaTabela(btu: number): number {
  const menoresOuIguais = BTUS_TABELA.filter((b) => b <= btu)
  return menoresOuIguais.length ? Math.max(...menoresOuIguais) : BTUS_TABELA[0]
}

/** Consumo mensal (kWh) de um ou mais ARs. */
export function consumoAcKwhMes(btu: number, horasDia: number, quantidade = 1): number {
  const btuRef = btuDaTabela(btu)
  return Math.round((btuRef / 1000) * FATOR_AC * horasDia * quantidade)
}

/** kWh/mês para cada 1h/dia de uso (base, sem multiplicar horas). */
export function consumoAcPorHora(btu: number): number {
  return Math.round((btuDaTabela(btu) / 1000) * FATOR_AC * 100) / 100
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Detecta pedido de ar-condicionado na mensagem do cliente (determinístico). */
export function extrairAc(text: string): { units: number; btu: number | null; hoursPerDay: number | null } | null {
  const t = norm(text)
  const ehAc = /ar.?condicionad|\bsplit\b|climatizad|\bbtus?\b/.test(t)
  if (!ehAc) return null

  // BTU: "9000 btu", "9.000", ou "9 mil"
  let btu: number | null = null
  const mil = t.match(/(\d{1,2})\s*mil/)
  const btuNum = t.match(/(\d{1,3}(?:[.\s]?\d{3})|\d{4,6})\s*btu/) || t.match(/\b(\d{4,6})\b/)
  if (mil) btu = parseInt(mil[1]) * 1000
  else if (btuNum) btu = parseInt(btuNum[1].replace(/[.\s]/g, ''))

  // Quantidade: "2 aparelhos", "2 ar", "3 split"
  let units = 1
  const q = t.match(/(\d+)\s*(aparelho|ar\b|split|unidad|maquina|equipamento)/)
  if (q) units = Math.max(1, parseInt(q[1]))

  // Horas/dia: "8 horas", "8h por dia"
  let hoursPerDay: number | null = null
  const h = t.match(/(\d{1,2})\s*(h\b|hora)/)
  if (h) hoursPerDay = parseInt(h[1])

  return { units, btu, hoursPerDay }
}
