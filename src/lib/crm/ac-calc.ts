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

// 26/11/2026 (Sheila: "12 e 24 bitus"): o cliente escreve "bitus", "bitu", "btus", "btu's", "btu"
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bb[iy]?t[uo]'?s?\b/g, 'btus')

/** "12 e 24 btus" / "9, 12 ou 18 btus" → [12000, 24000] (números curtos antes de "btus" = milhares). */
function btusCurtos(t: string): number[] {
  const out: number[] = []
  for (const m of t.matchAll(/((?:\d{1,2}\s*(?:,|e|ou|\+)\s*)*\d{1,2})\s*(?:mil\s*)?btus\b/g)) {
    for (const n of m[1].split(/\s*(?:,|e|ou|\+)\s*/)) {
      const v = parseInt(n, 10)
      if (v >= 5 && v <= 60) out.push(v * 1000)
    }
  }
  return out
}

/** Todos os BTUs citados ("7500 e 9000", "7.500 ou 9.000 btus", "9 mil e 12 mil", "12 e 24 bitus") e se são
 *  ALTERNATIVAS ("ou") ou aparelhos DIFERENTES ("e"). 24/11/2026 (Jonni: "2 ar condicionados de 7500 ou 9000 btus"). */
export function extrairBtus(text: string): { btus: number[]; alternativas: boolean } {
  const t = norm(text)
  const btus: number[] = [...btusCurtos(t)]
  for (const m of t.matchAll(/(\d{1,2})\s*mil\b/g)) btus.push(parseInt(m[1]) * 1000)
  for (const m of t.matchAll(/\b(\d{1,2}[.\s]\d{3}|\d{4,5})\b/g)) {
    const v = parseInt(m[1].replace(/[.\s]/g, ''))
    if (v >= 5000 && v <= 60000 && v % 500 === 0) btus.push(v)
  }
  const unicos = [...new Set(btus)]
  return { btus: unicos, alternativas: unicos.length > 1 && /\d\s*(btus?\s*)?\s+ou\s+\d/.test(t) }
}

/** Detecta pedido de ar-condicionado na mensagem do cliente (determinístico). */
/**
 * Horas por dia ditas pelo cliente — só com "hora(s)/h" ou "por dia", e nunca em negação
 * (26/11/2026, Sheila: "Eu não vou ligar 24 por dia" virou 24 h/dia). "12 e 24 btus" NÃO são horas.
 */
export function horasDoTexto(text: string): number | null {
  const t = norm(text)
  const m = /(\d{1,2})\s*(?:h\b|hs\b|horas?\b|por dia\b|\/dia\b|ao dia\b)/.exec(t)
  if (!m) return null
  const antes = t.slice(Math.max(0, m.index - 30), m.index)
  if (/\b(nao|nem|jamais|nunca)\b/.test(antes)) return null
  const h = parseInt(m[1], 10)
  return h >= 1 && h <= 24 ? h : null
}

/** Texto do cliente pode trazer horas? (para aceitar o que a IA leu) */
export function textoFalaDeHoras(text: string): boolean {
  return horasDoTexto(text) != null
}

export function extrairAc(text: string): { units: number; btu: number | null; hoursPerDay: number | null; btus?: number[] } | null {
  const t = norm(text)
  const ehAc =
    /ar.?condicionad|\bsplit\b|climatizad|\bbtus?\b/.test(t)
    // "ar" abreviado em contexto CLARO de ar-condicionado (cliente escreve só "2 ar"):
    //   • quantificador + ar: "2 ar", "um ar", "mais ar", "outro ar"
    //   • verbo de instalar/usar + ar: "colocar ar", "instalar 2 ar", "vou por um ar"
    //   • "o ar / os ares / meu ar" (artigo/possessivo + ar)
    // Usa limites de palavra pra NÃO casar "ar" dentro de outras palavras (lugar, para, etc.).
    || /\b(\d+|um|uma|dois|duas|tr[eê]s|mais|outro|outra|novo|nova)\s+ar(es|zinho)?\b/.test(t)
    || /\b(coloca\w*|instala\w*|bota\w*|p[oô]r|p[oô]e|liga\w*|compra\w*|adiciona\w*|monta\w*)\s+(?:\w+\s+){0,3}ar(es|zinho)?\b/.test(t)
    || /\b(o|os|meu|meus)\s+ar(es|zinho)?\b/.test(t)
  if (!ehAc) return null

  // BTU: "9000 btu", "9.000", "9 mil", "12 e 24 btus"
  let btu: number | null = null
  const lidos = extrairBtus(text)
  const mil = t.match(/(\d{1,2})\s*mil/)
  const btuNum = t.match(/(\d{1,3}(?:[.\s]?\d{3})|\d{4,6})\s*btu/) || t.match(/\b(\d{4,6})\b/)
  if (lidos.btus.length) btu = lidos.btus[0]
  else if (mil) btu = parseInt(mil[1]) * 1000
  else if (btuNum) btu = parseInt(btuNum[1].replace(/[.\s]/g, ''))

  // Quantidade: "2 aparelhos", "2 ar", "3 split"; "12 e 24 btus" = 2 aparelhos diferentes
  let units = 1
  const q = t.match(/(\d+)\s*(aparelho|ar\b|split|unidad|maquina|equipamento)/)
  if (q) units = Math.max(1, parseInt(q[1]))
  if (lidos.btus.length > 1 && !lidos.alternativas) units = Math.max(units, lidos.btus.length)

  // Horas/dia: "8 horas", "8h por dia", "8 por dia" (nunca em negação)
  const hoursPerDay = horasDoTexto(text)

  return { units, btu, hoursPerDay, ...(lidos.btus.length > 1 ? { btus: lidos.btus } : {}) }
}
