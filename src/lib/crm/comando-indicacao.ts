// Comando do operador para mandar orçamento (parte pura, testável). Ver comandoIndicacaoKwh em flow.ts.
//
// 16/11/2026: o dono explicava a um cliente o caso de OUTRO cliente ("... 800 kWh ...") e o CRM mandou um
// orçamento que ninguém pediu — a regra antiga aceitava "faz", "passo", "mando", "indicação", "kit"... em
// QUALQUER ponto de qualquer frase. Regra do dono (16/11/2026): o comando é SEMPRE "faz XXXX", com XXXX em
// kWh ou em reais, e a mensagem é só isso; fora disso, NUNCA manda orçamento — o texto vai como foi escrito.
//   "faz 800 kwh" · "faz 1.200kWh" · "faz 600 kwh híbrido"  → por consumo
//   "faz R$ 600" · "faz para 600 reais" · "faz r$600,00"    → por valor da conta
//   ("para"/"pra" depois do "faz" é opcional; o texto do comando NUNCA vai ao cliente, só o orçamento)
//   "faz 800" (sem unidade)                                  → NÃO adivinha: pede para dizer kWh ou R$

export type Medidor = 'monofásico' | 'bifásico' | 'trifásico'
export type ComandoOrcamento =
  | { tipo: 'kwh'; valor: number; medidor?: Medidor }
  | { tipo: 'reais'; valor: number; medidor?: Medidor }
  | { erro: string }

function numero(bruto: string): number {
  const raw = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.')
    : (/^\d{1,3}(\.\d{3})+$/.test(bruto) ? bruto.replace(/\./g, '') : bruto)
  return Math.round(parseFloat(raw) || 0)
}

// 💳 Comandos de SIMULAÇÃO (regra do dono, 24/11/2026) — a mensagem inteira é o comando; o texto dele nunca
// vai ao cliente, só a simulação:
//   "simula financiamento valor 30.000" · "simula financiamento de R$ 30.000,00" · "simula financiamento 30 mil"
//   "simula cartão de R$ 15.000" · "simula cartao 15000"   → cartão de 2x até 24x
export type ComandoSimulacao =
  | { tipo: 'financiamento' | 'cartao'; valor: number }
  | { erro: string }

export function lerComandoSimulacao(text: string): ComandoSimulacao | null {
  const t = (text || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const m = /^simul[ae]r?\s+(?:o\s+|um\s+)?(financiamento|cartao|cartao de credito)\b\s*(.*)$/.exec(t)
  if (!m) return null
  const tipo = m[1].startsWith('cartao') ? 'cartao' as const : 'financiamento' as const
  const resto = m[2].replace(/^(?:de\s+credito\s+)?(?:no\s+valor\s+de|valor\s+de|valor|de|para|pra|p\/)\s*/, '').trim()
  const v = /^(?:r\$\s*)?([\d.,]+)\s*(mil|k)?\s*(?:reais|real)?\s*[.!]?$/.exec(resto)
  if (!v) return { erro: `Faltou o valor: escreva "simula ${tipo === 'cartao' ? 'cartão de R$ 15.000' : 'financiamento valor 30.000'}". Nada foi enviado ao cliente.` }
  const bruto = v[1]
  const f = bruto.includes(',') ? parseFloat(bruto.replace(/\./g, '').replace(',', '.'))
    : /^\d{1,3}(\.\d{3})+$/.test(bruto) ? parseFloat(bruto.replace(/\./g, '')) : parseFloat(bruto)
  const valor = Math.round((f || 0) * (v[2] ? 1000 : 1) * 100) / 100
  if (!(valor > 0)) return { erro: 'O valor precisa ser maior que zero. Nada foi enviado ao cliente.' }
  return { tipo, valor }
}

// 🔢 Orçamento por QUANTIDADE DE PLACAS (dono, 25/11/2026) — a mensagem inteira é o comando:
//   "faz orçamento 4 placas de 700W com microinversor e telhado cerâmico"
//   "faz 10 placas de 620w telhado fibrocimento" · "orçamento de 6 painéis 700 w micro"
// Placa em W (opcional: sem ela usa a faixa de 600 W da regra), micro (opcional), telhado (opcional: texto livre
// depois de "telhado"). O texto do comando nunca vai ao cliente, só o orçamento.
export type ComandoPlacas = { placas: number; potenciaW: number | null; micro: boolean; telhado: string | null; hibrido: boolean; medidor?: Medidor }

export function lerComandoPlacas(text: string): ComandoPlacas | null {
  const t = (text || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
  const m = /^(?:faz(?:er)?\s+)?(?:(?:um|o)\s+)?(?:orcamento\s+)?(?:de\s+|com\s+|para\s+|pra\s+)?(\d{1,3})\s*(?:placas?|paineis|painel|modulos?)\b(.*)$/.exec(t)
  if (!m) return null
  // precisa começar com "faz" ou "orçamento" (frase solta "4 placas..." não é comando)
  if (!/^(faz|orcamento)/.test(t)) return null
  const placas = parseInt(m[1], 10)
  let resto = ` ${m[2]} `
  let potenciaW: number | null = null
  const w = /\s(?:de\s+)?(\d{3,4})\s*(?:w|wp|watts?)\b/.exec(resto)
  if (w) { potenciaW = parseInt(w[1], 10); resto = resto.replace(w[0], ' ') }
  const micro = /\bmicro/.test(resto)
  resto = resto.replace(/\b(?:com\s+)?micro\s*-?\s*(?:inversor(?:es)?)?\b/g, ' ')
  const hibrido = /\bh[iy]brido\b/.test(resto)
  resto = resto.replace(/\bh[iy]brido\b/g, ' ')
  let medidor: Medidor | null = null
  const md = /\b(?:medidor\s+|padrao\s+)?(mono|bi|tri)fasic[oa]\b/.exec(resto)
  if (md) { medidor = md[1] === 'mono' ? 'monofásico' : md[1] === 'bi' ? 'bifásico' : 'trifásico'; resto = resto.replace(md[0], ' ') }
  let telhado: string | null = null
  const tel = /\b(?:no\s+|em\s+|com\s+|e\s+)?telhado\s+(?:de\s+)?([a-z ]+?)\s*$/.exec(resto)
  if (tel) { telhado = tel[1].trim() || null; resto = resto.replace(tel[0], ' ') }
  // sobrou algo além de conectivos → não é o comando (vai como texto normal)
  if (resto.replace(/\b(?:e|com|de|para|pra|no|na|em|o|a|inversor|string|on ?grid)\b/g, '').trim()) return null
  if (!(placas > 0) || placas > 200) return null
  if (potenciaW != null && (potenciaW < 300 || potenciaW > 900)) return null
  return { placas, potenciaW, micro, telhado, hibrido, ...(medidor ? { medidor } : {}) }
}

export function lerComandoIndicacao(text: string): ComandoOrcamento | null {
  // 26/11/2026 (Iara): "Faz 300 Kwh Monofásico" saiu como texto — o medidor no fim também faz parte do comando
  const med = /\s+(?:medidor\s+|padr[aã]o\s+)?(mono|bi|tri)f[aá]sic[oa]\b/i.exec(text || '')
  if (med) {
    const r = lerComandoIndicacao((text || '').replace(med[0], ' ').replace(/\s+/g, ' '))
    if (!r || 'erro' in r) return r
    const tipoMed = med[1].toLowerCase()
    return { ...r, medidor: tipoMed === 'mono' ? 'monofásico' : tipoMed === 'bi' ? 'bifásico' : 'trifásico' }
  }
  // "faz para 600 reais" / "faz pra 800 kwh" = mesmo comando (o dono escreve assim)
  const t = (text || '').trim().replace(/^faz\s+(?:para|pra|p\/)\s+/i, 'faz ')
  const fim = String.raw`\s*(?:h[ií]brido)?\s*[.!]?$`
  const reaisAntes = new RegExp(String.raw`^faz\s+r\$\s*([\d.,]+)` + fim, 'i').exec(t)
  if (reaisAntes) return { tipo: 'reais', valor: numero(reaisAntes[1]) }
  const reaisDepois = new RegExp(String.raw`^faz\s+([\d.,]+)\s*(?:reais|real)` + fim, 'i').exec(t)
  if (reaisDepois) return { tipo: 'reais', valor: numero(reaisDepois[1]) }
  const kwh = new RegExp(String.raw`^faz\s+([\d.,]+)\s*(?:kwh|kw\/h|kw|k)` + fim, 'i').exec(t)
  if (kwh) return { tipo: 'kwh', valor: numero(kwh[1]) }
  if (/^faz\s+[\d.,]+\s*[.!]?$/i.test(t)) return { erro: 'Faltou a unidade: escreva "faz 800 kwh" (consumo) ou "faz R$ 800" (valor da conta). Nada foi enviado ao cliente.' }
  return null
}
