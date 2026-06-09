import 'server-only'

/**
 * Motor de cálculo solar — réplica exata do simulador da Kerosolar
 * (https://lp.kerosolar.com.br/simulador/)
 */

export const FATOR_CONVERSAO = 20.87      // valor do sistema = conta × 20,87
export const ECONOMIA_PERCENT_PADRAO = 80 // % de economia (70–85)
export const REAJUSTE_PADRAO = 8          // reajuste anual da energia (%)
export const TARIFA_KWH = 1.22            // R$ por kWh — usado p/ comunicar "atende conta de ~R$ (kWh × 1,22)"
export const MINIMO_KWH = 300             // abaixo disso oferecemos o kit mínimo (300 kWh)
export const MINIMO_KIT_KWH = 300         // menor kit que a Kerosolar oferece
export const MINIMO_KIT_PRECO = 7670      // preço fixo do kit mínimo (R$ 7.670,00)

// 🔒 FAIXAS REALISTAS — trava de segurança contra valor absurdo (código de barras /
// nº de instalação do PDF, erro de OCR). Fora disso NÃO calculamos orçamento.
export const CONSUMO_MIN_KWH = 30
export const CONSUMO_MAX_KWH = 50000      // acima de 50 mil kWh/mês não é conta residencial/comercial comum
export const CONTA_MIN_REAIS = 30
export const CONTA_MAX_REAIS = 100000     // acima de R$ 100 mil/mês → caso atípico, vai pro humano

/** Consumo em kWh é um número confiável (dentro da faixa realista)? */
export function consumoKwhValido(n: number | null | undefined): n is number {
  return typeof n === 'number' && isFinite(n) && n >= CONSUMO_MIN_KWH && n <= CONSUMO_MAX_KWH
}
/** Valor da conta em R$ é confiável (dentro da faixa realista)? */
export function contaReaisValida(n: number | null | undefined): n is number {
  return typeof n === 'number' && isFinite(n) && n >= CONTA_MIN_REAIS && n <= CONTA_MAX_REAIS
}

// Taxas de financiamento (% ao mês) por prazo
export const TAXAS_FINANCIAMENTO: Record<number, number> = {
  24: 1.49, 36: 1.60, 48: 1.64, 60: 1.68, 72: 1.72, 84: 1.76, 96: 1.80,
}

export type SolarResult = {
  contaReais: number
  consumoKwh: number
  valorSistema: number
  economiaMensal: number
  economiaAnual: number
  paybackAnos: number
  economia5Anos: number
  economia30Anos: number
  roiPercent: number
  vsPoupanca: number
  financiamento: { prazo: number; parcela: number; taxa: number }[]
  menorParcela: number
  economiaImediata: number   // conta atual − menor parcela (economia já no 1º mês)
  baixoConsumo: boolean      // consumo < 250 kWh → solar sozinho economiza pouco
}

// Observações exatamente como na página do simulador
export const OBSERVACOES = {
  sistema: 'O valor do sistema solar é calculado com base na sua conta de luz. Pode ser ajustado conforme o projeto.',
  financiamento: 'As parcelas e taxas são simuladas com base em valores médios de mercado. O valor final da parcela pode sofrer modificações de acordo com o perfil de crédito do cliente.',
  carencia: 'Carência de 120 dias: você começa a economizar na conta de luz antes de pagar a primeira parcela!',
  comparacao: 'Você começa a economizar desde o primeiro mês! Troque uma conta que só aumenta por uma parcela fixa.',
  disclaimer: 'Simulação baseada em dados informados. Os resultados reais podem variar conforme concessionária, localização, tipo de sistema e aprovação de crédito.',
}

/** kWh → R$ (R$1000 = 800 kWh). */
export function kwhParaReais(kwh: number): number {
  return kwh * TARIFA_KWH
}
/** R$ → kWh. */
export function reaisParaKwh(reais: number): number {
  return reais / TARIFA_KWH
}

function calcularParcela(valor: number, meses: number, taxaMensalPercent: number): number {
  if (valor <= 0) return 0
  const taxa = taxaMensalPercent / 100
  if (taxa === 0) return valor / meses
  return valor * (taxa * Math.pow(1 + taxa, meses)) / (Math.pow(1 + taxa, meses) - 1)
}

/**
 * Núcleo do cálculo. valorSistema é informado explicitamente:
 * - quando o cliente dá kWh:   valorSistema = kWh × 20,87
 * - quando o cliente dá R$:    valorSistema = R$ × 20,87
 * contaReais (a conta em R$) é usada para a ECONOMIA.
 */
function calcularCore(
  contaReais: number,
  valorSistema: number,
  consumoKwh: number,
  opts: { economiaPercent?: number; reajuste?: number } = {},
): SolarResult {
  const economiaPercent = Math.min(100, Math.max(0, opts.economiaPercent ?? ECONOMIA_PERCENT_PADRAO))
  const reajuste = opts.reajuste ?? REAJUSTE_PADRAO

  const economiaMensal = contaReais * (economiaPercent / 100)
  const economiaAnual = economiaMensal * 12
  const paybackAnos = economiaAnual > 0 ? Math.round((valorSistema / economiaAnual) * 10) / 10 : 0

  let economia5Anos = 0, acc5 = economiaAnual
  for (let i = 0; i < 5; i++) { economia5Anos += acc5; acc5 *= 1 + reajuste / 100 }

  let economia30Anos = 0, acc30 = economiaAnual
  for (let i = 0; i < 30; i++) { economia30Anos += acc30; acc30 *= 1 + reajuste / 100 }

  const roiPercent = valorSistema > 0 ? ((economia30Anos - valorSistema) / valorSistema) * 100 : 0

  let rendimentoPoupanca = 0, invPoup = valorSistema
  for (let i = 0; i < 30; i++) { rendimentoPoupanca += invPoup * 0.05; invPoup *= 1.05 }
  const vsPoupanca = rendimentoPoupanca > 0 ? Math.round(economia30Anos / rendimentoPoupanca) : 0

  const financiamento = Object.keys(TAXAS_FINANCIAMENTO).map(Number).sort((a, b) => a - b).map((prazo) => ({
    prazo, taxa: TAXAS_FINANCIAMENTO[prazo], parcela: calcularParcela(valorSistema, prazo, TAXAS_FINANCIAMENTO[prazo]),
  }))
  const menorParcela = Math.min(...financiamento.map((f) => f.parcela).filter((p) => p > 0))

  const economiaImediata = Math.max(0, contaReais - menorParcela)

  return {
    contaReais: Math.round(contaReais),
    consumoKwh: Math.round(consumoKwh),
    valorSistema,
    economiaMensal: Math.round(economiaMensal),
    economiaAnual: Math.round(economiaAnual),
    paybackAnos,
    economia5Anos: Math.round(economia5Anos),
    economia30Anos: Math.round(economia30Anos),
    roiPercent: Math.round(roiPercent),
    vsPoupanca,
    financiamento: financiamento.map((f) => ({ ...f, parcela: Math.round(f.parcela * 100) / 100 })),
    menorParcela: Math.round(menorParcela * 100) / 100,
    economiaImediata: Math.round(economiaImediata * 100) / 100,
    baixoConsumo: Math.round(consumoKwh) < MINIMO_KWH,
  }
}

/** Cliente informou a CONTA em R$ → converte pra kWh (÷ tarifa) e o sistema = kWh × 20,87. */
export function calcularSolar(contaReais: number, opts?: { economiaPercent?: number; reajuste?: number }): SolarResult {
  const kwh = reaisParaKwh(contaReais)           // R$ → kWh (÷ 1,22)
  return calcularCore(contaReais, Math.round(kwh * FATOR_CONVERSAO), kwh, opts)
}

/** Cliente informou o CONSUMO em kWh → sistema = kWh × 20,87; conta = kWh × tarifa (para a economia). */
export function calcularSolarPorKwh(kwh: number, opts?: { economiaPercent?: number; reajuste?: number }): SolarResult {
  return calcularCore(kwhParaReais(kwh), Math.round(kwh * FATOR_CONVERSAO), kwh, opts)
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Resumo COMPLETO para a IA (todos os dados do simulador + observações). */
export function resumoParaIA(r: SolarResult): string {
  const fin = r.financiamento.map((f) => `${f.prazo}x de ${brl(f.parcela)} (${f.taxa}% a.m.)`).join('; ')
  return [
    `Conta de luz: ${brl(r.contaReais)}/mês (~${r.consumoKwh} kWh)`,
    `Valor do sistema (instalado e homologado): ${brl(r.valorSistema)}`,
    `Economia mensal: ${brl(r.economiaMensal)} | anual: ${brl(r.economiaAnual)}`,
    `Payback: ${r.paybackAnos} anos`,
    `Economia em 5 anos: ${brl(r.economia5Anos)} | em 30 anos: ${brl(r.economia30Anos)}`,
    `ROI em 30 anos: ${r.roiPercent}% (${r.vsPoupanca}x mais que a poupança)`,
    `Financiamento (carência até 120 dias): ${fin}`,
    `Menor parcela: ${brl(r.menorParcela)} — economia imediata vs conta atual: ${brl(r.economiaImediata)}/mês`,
    `OBSERVAÇÕES: ${OBSERVACOES.financiamento} ${OBSERVACOES.carencia} ${OBSERVACOES.disclaimer}`,
  ].join('. ')
}

/** Orçamento formatado (estilo WhatsApp) — limpo e comercial, negrito (*..*) nos pontos-chave. */
export function orcamentoTexto(r: SolarResult): string {
  // Mostra só 3 prazos pra não poluir: o de menor parcela (mais longo) + 60x + 36x
  const ord = [...r.financiamento].sort((a, b) => a.prazo - b.prazo)
  const longo = ord[ord.length - 1]
  const medio = ord.find((f) => f.prazo === 60) ?? ord[Math.floor(ord.length / 2)]
  const curto = ord.find((f) => f.prazo === 36) ?? ord[0]
  const planos = [longo, medio, curto]
    .filter((f, i, a) => f && a.findIndex((x) => x.prazo === f.prazo) === i)
    .map((f) => `• ${f.prazo}x de *${brl(f.parcela)}*`)
    .join('\n')

  return (
`☀️ *ORÇAMENTO SOLAR · KEROSOLAR*

🔆 *Sistema completo: ${brl(r.valorSistema)}*
_Instalado e homologado, pronto pra gerar energia._

📊 *Seus números*
• Conta de luz hoje: ${brl(r.contaReais)}/mês
• Economia: *${brl(r.economiaMensal)}/mês*
• Retorno do investimento: *${r.paybackAnos.toLocaleString('pt-BR')} anos*
• Em 30 anos você economiza *${brl(r.economia30Anos)}*

💳 *Financiamento* — 1ª parcela só daqui a 120 dias:
${planos}

✅ *Já no 1º mês a parcela fica menor que a sua conta de luz* — você economiza ${brl(r.economiaImediata)}/mês desde o começo.

📄 *Pra um orçamento 100% certo, o ideal é a sua conta de luz* — o cálculo é feito pela *média anual de kWh* (e não por um mês só). Se ainda não enviou, me manda a conta (foto ou PDF) que sai perfeito! E se quiser uma marca específica de painel/inversor, é só falar 😊

_Valores podem variar conforme o projeto e a aprovação de crédito._`
  )
}

// ── Extração de valor da mensagem do cliente ──────────────────────────────────
function parseBrNumber(s: string): number {
  s = s.trim().replace(/\s/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')        // 1.250,50 → 1250.50
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')        // 1.250 → 1250
  return parseFloat(s) || 0
}

/** Tenta extrair consumo (kWh) e/ou valor (R$) de um texto livre. Retorna ambos quando disponíveis. */
// 1 painel/placa/módulo ≈ 60 kWh/mês (regra comercial KeroSolar)
const KWH_POR_PAINEL = 60

export function extrairConsumo(text: string): { reais?: number; kwh?: number } {
  const t = text.toLowerCase()
  // ⚠️ Comparação com CONCORRENTE ("recebi um orçamento R$ X mais barato", "outra empresa")
  // → o valor citado é o PREÇO do concorrente, NÃO o consumo/conta do cliente. Não extrai nada.
  if (/mais barato|mais em conta|bem barato|concorrent|outra empresa|outro or[çc]amento|outro lugar/i.test(t)) return {}
  let kwh: number | undefined
  let reais: number | undefined

  // Pedido por nº de placas/painéis/módulos → converte para kWh (1 painel = 60 kWh)
  // Ex.: "5 painéis" = 300 kWh, "10 placas" = 600 kWh. Ignora a potência em W ("540w").
  const painelMatch = t.match(/(\d+)\s*(pain[eé]is|painel|placas?|m[oó]dulos?)/)
  if (painelMatch) { const n = parseInt(painelMatch[1], 10); const k = n * KWH_POR_PAINEL; if (consumoKwhValido(k)) kwh = k }

  if (!kwh) {
    const kwhMatch = t.match(/([\d.,]+)\s*(kwh|kw\/h|quilowatt|kw h)/)
    if (kwhMatch) { const k = parseBrNumber(kwhMatch[1]); if (consumoKwhValido(k)) kwh = k }
  }

  // Valor da fatura: "Valor a pagar: R$ 294,41" ou "R$ 294,41" ou variações
  const reaisMatch =
    t.match(/valor\s+a\s+pagar[^0-9]{0,20}([\d.,]+)/) ||
    t.match(/total\s+a\s+pagar[^0-9]{0,20}([\d.,]+)/) ||
    t.match(/r\$\s*([\d.,]+)/) ||
    t.match(/([\d.,]+)\s*reais/) ||
    t.match(/(?:conta|fatura|gasto|pago|vem|fica|paga)\D{0,15}?([\d.,]+)/)
  if (reaisMatch) { const v = parseBrNumber(reaisMatch[1]); if (contaReaisValida(v)) reais = v }

  if (kwh) return { kwh, reais }  // retorna os dois quando kWh encontrado
  if (reais) return { reais }
  return {}
}
