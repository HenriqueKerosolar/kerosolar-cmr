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

export type ComandoOrcamento =
  | { tipo: 'kwh'; valor: number }
  | { tipo: 'reais'; valor: number }
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

export function lerComandoIndicacao(text: string): ComandoOrcamento | null {
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
