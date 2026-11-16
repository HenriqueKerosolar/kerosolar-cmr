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
