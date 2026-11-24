// 🤖 Cotação automática na Belenus (Gerador Personalizado) — parte PURA (testável, sem rede e sem banco).
// As regras genéricas e o conector vêm da Biblioteca (biblioteca.lock.json):
//   • @lib/dimensionamento-solar — módulo, inversor, strings, cabos, DPS, estrutura, margem, fórmula HSP;
//   • @lib/conector-belenus     — rotas permitidas/proibidas (trava de compra), leitura das respostas, corpos do site.
// Aqui fica SÓ o que é da KeroSolar: a CONFIGURAÇÃO (valores do dono), os comandos do operador, a leitura dos
// campos do lead e o texto da nota interna. Regras do dono: memória "regras-negocio-kerosolar.md", seção
// "Dimensionamento e preço do kit pela Belenus" (24/11/2026).

import {
  aplicarRegrasComponentes as aplicarRegrasComponentesLib, calcularCabos as calcularCabosLib, calcularDps as calcularDpsLib,
  calcularStrings as calcularStringsLib, dimensionarPorConsumo, ehMarca as ehMarcaTexto, escolherInversor as escolherInversorLib,
  escolherMicro as escolherMicroLib, escolherModulo, geracaoEstimada, valorAoCliente as valorAoClienteLib,
  type Ligacao, type RegrasComponentes, type RegrasInversor,
} from '@lib/dimensionamento-solar'
import { LEITOR_INVERSOR, ehObj, marcaDe, ordenarComoSite, potenciaModuloW, type ItemKit, type Obj } from '@lib/conector-belenus'
import type { Confirmacao } from '@lib/conector-belenus'

// Reexportações (o resto do CRM importa daqui)
export {
  PALAVRAS_TELHADO, bitolaMm, corDoCabo, ehDps, lerLigacao, lerTelhado, lerTensao, semAcento,
  type Cabos, type CorCabo, type Ligacao, type Telhado,
} from '@lib/dimensionamento-solar'
export {
  BELENUS_BASE, RE_NAO_ON_GRID, RE_ON_GRID, ROTA_BUSCAR_FRETES, ROTA_CONFIRMAR, ROTA_LOGIN, ROTA_PROIBIDA, ROTA_SALVAR_ORCAMENTO,
  ROTA_VALOR_SEGURO, ROTAS_PERMITIDAS, campo, codigoDe, corpoSalvarOrcamento, descricaoDe, ehObj, escolherOpcao, formaResposta,
  freteEntregaNoCliente, lerConfirmacao, listaDe, mensagensBelenus, num, numeroCotacaoDe, opcaoTexto, ordenarComoSite, potenciaKw,
  potenciaW, precoDe, qtdeDe, reLigacao, reTensao, rotaPermitida, semRepetidos, valorSeguroDe,
  type Confirmacao, type Obj,
} from '@lib/conector-belenus'

// ── CONFIGURAÇÃO DA KEROSOLAR (valores do dono, 24/11/2026) ──────────────────
/** Inversor: AUXSOL 50% (preferido) → AUXSOL 100% (máximo da marca) → DEYE → SOLIS → outras com 50%. */
export const REGRAS_INVERSOR_KEROSOLAR: RegrasInversor = {
  overloadPadrao: 1.5,
  overloadPorMarca: { AUXSOL: { preferido: 1.5, maximo: 2 } },
  overloadMinimoAtende: 1.3,
  ordemMarcas: ['AUXSOL', 'DEYE', 'SOLIS'],
  // medidor monofásico: inversor até 5 kW; exceção de overload até 85% (kit até 9,25 kWp); acima → trifásico + transformador
  monofasico: { limiteKw: 5, overloadExcecao: 1.85 },
}
/** Strings/cabos/DPS: 8 painéis por string; 25 m de preto e vermelho por string, 6 mm; verde 25 m (1 string) ou metade do vermelho. */
export const REGRAS_COMPONENTES_KEROSOLAR: RegrasComponentes = {
  paineisPorString: 8, metrosCaboPorString: 25, bitolaCaboMm: 6, fracaoVerde: 0.5,
  dps: { 'monofásico': 2, 'bifásico': 2, 'trifásico': 3 },
}
/** Fórmula do dono: kWp = consumo ÷ (HSP × 30 × (1 − perdas)); HSP 4,5 e perdas de 20%. */
export const GERACAO_KEROSOLAR = { hsp: 4.5, perdas: 0.2 }
/** Placa de referência quando ainda não há módulo escolhido. */
export const PAINEL_REFERENCIA_W = 620
export const FAIXA_MODULO_KEROSOLAR = { minW: 600, maxW: 700 }
export const ESTRUTURA_DE_N_PAINEIS = 4
/** Micro inversor (quando o cliente pede): DEYE, 1 micro para cada 4 placas. */
export const MICRO_KEROSOLAR = { marca: 'DEYE', placasPorMicro: 4 }
/** Margem de 60% "de tudo" sobre o custo da API; transformador (medidor monofásico) fora da margem. */
export const PRECO_KEROSOLAR = { multiplicador: 1.6, transformador: 600 }
export const ROTULOS_AJUSTE_KEROSOLAR = { regra: 'regra do dono', fornecedor: 'Belenus', fornecedorSujeito: 'a Belenus' }

// nomes antigos (usados pelo resto do CRM)
export const MARCA_PREFERIDA = REGRAS_INVERSOR_KEROSOLAR.ordemMarcas[0]
export const LIMITE_MONOFASICO_KW = REGRAS_INVERSOR_KEROSOLAR.monofasico.limiteKw
export const OVERLOAD_MONOFASICO_LIMITE = REGRAS_INVERSOR_KEROSOLAR.monofasico.overloadExcecao
export const PLACAS_POR_MICRO = MICRO_KEROSOLAR.placasPorMicro
export const TRANSFORMADOR_PRECO = PRECO_KEROSOLAR.transformador
export const MARGEM_KEROSOLAR = PRECO_KEROSOLAR.multiplicador
export const PAINEIS_POR_STRING = REGRAS_COMPONENTES_KEROSOLAR.paineisPorString
export const METROS_CABO_POR_STRING = REGRAS_COMPONENTES_KEROSOLAR.metrosCaboPorString
export const BITOLA_CABO_MM = REGRAS_COMPONENTES_KEROSOLAR.bitolaCaboMm

// ── Comando do operador ──────────────────────────────────────────────────────
//   "cota belenus 4,34 kWp" · "cota belenus 4.34kwp" · "cota belenus 4,34" → potência informada
//   "cota belenus"                                                     → usa o consumo do lead → kWp
export type ComandoBelenus = { kwp: number | null; micro?: boolean } | { erro: string }

export function lerComandoBelenus(text: string): ComandoBelenus | null {
  const t = (text || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const m = /^cot[ae]r?\s+(?:na\s+)?belenus\b\s*(.*)$/.exec(t)
  if (!m) return null
  // 24/11/2026: 'micro' no comando → micro inversor Deye (1 para cada 4 placas)
  const micro = /\bmicro/.test(m[1])
  const resto = m[1].replace(/[.!]+$/, '').replace(/\bmicro\s*(?:inversor(?:es)?)?\b/g, '').replace(/\s+/g, ' ').trim()
  if (!resto) return { kwp: null, ...(micro ? { micro } : {}) }
  const v = /^(?:de\s+|com\s+|para\s+|pra\s+)?(\d+(?:[.,]\d+)?)\s*(?:kwp|kw)?$/.exec(resto)
  if (!v) return { erro: 'Não entendi a potência: escreva "cota belenus 4,34 kWp" (ou só "cota belenus" para usar o consumo do lead). Nada foi enviado ao cliente.' }
  const kwp = parseFloat(v[1].replace(',', '.'))
  if (!(kwp > 0) || kwp > 300) return { erro: 'A potência precisa ser maior que zero (em kWp, ex.: "cota belenus 4,34 kWp"). Nada foi enviado ao cliente.' }
  return { kwp: Math.round(kwp * 100) / 100, ...(micro ? { micro } : {}) }
}

// ── Consumo do lead → kWp (quando o operador escreve só "cota belenus") ─────────
// Fórmula do dono (24/11/2026; substitui "1 painel = 60 kWh"): kWp = consumo ÷ (HSP 4,5 × 30 × (1 − 20%)).
export function kwpPorConsumo(kwhMes: number): number {
  return dimensionarPorConsumo(kwhMes, { ...GERACAO_KEROSOLAR, painelW: PAINEL_REFERENCIA_W }).kwp
}
/** Dimensionamento completo pelo consumo (kWp, placas de 620 W, kWp do kit, geração). */
export function dimensionarConsumoKeroSolar(kwhMes: number) {
  return dimensionarPorConsumo(kwhMes, { ...GERACAO_KEROSOLAR, painelW: PAINEL_REFERENCIA_W })
}
/** Geração estimada (kWh/mês e kWh/ano) de um kit de `kwpKit` kWp. */
export function geracaoKeroSolar(kwpKit: number): { mensal: number; anual: number } {
  return geracaoEstimada(kwpKit, GERACAO_KEROSOLAR)
}

// ── Módulo e inversor (adaptadores: lista da Belenus → regras da peça) ────────
/** Primeiro da lista (ordem do site) na faixa de 600 W (600–699 W). */
export function escolherModulo600(modulos: Obj[]): Obj | null {
  return escolherModulo(ordenarComoSite(modulos), potenciaModuloW, FAIXA_MODULO_KEROSOLAR)
}

export type EscolhaInversor = { inversor: Obj; qtdeSugeridaBelenus: number } | { motivo: 'mais-de-um' | 'acima-limite' | 'nenhum' | 'fora-da-faixa' }

export function escolherInversor(inversores: Obj[], opts: { limiteKw?: number; kwpKit?: number; somenteFaixa?: boolean } = {}): EscolhaInversor {
  const r = escolherInversorLib(ordenarComoSite(inversores), LEITOR_INVERSOR, REGRAS_INVERSOR_KEROSOLAR, opts)
  return 'inversor' in r ? { inversor: r.inversor, qtdeSugeridaBelenus: r.qtdeSugerida } : r
}

/** Micro inversor: DEYE, o de maior potência da lista de micros. */
export function escolherMicro(inversores: Obj[]): EscolhaInversor {
  const r = escolherMicroLib(inversores, LEITOR_INVERSOR, MICRO_KEROSOLAR)
  return 'inversor' in r ? { inversor: r.inversor, qtdeSugeridaBelenus: r.qtdeSugerida } : r
}

export const ehMarca = (inv: unknown, marca: string): boolean => ehMarcaTexto(marcaDe(inv), marca)
export const ehMarcaPreferida = (inv: unknown): boolean => ehMarca(inv, MARCA_PREFERIDA)

// ── Strings, cabos e DPS (regra do dono) ─────────────────────────────────────
export const calcularStrings = (qtdModulos: number): number => calcularStringsLib(qtdModulos, REGRAS_COMPONENTES_KEROSOLAR)
export const calcularCabos = (strings: number) => calcularCabosLib(strings, REGRAS_COMPONENTES_KEROSOLAR)
export const calcularDps = (ligacao: Ligacao): number => calcularDpsLib(ligacao, REGRAS_COMPONENTES_KEROSOLAR)

export type Peca = ItemKit
export { paraItem as paraPeca } from '@lib/conector-belenus'

/** Cabos 6 mm (25 m por string; verde 25 m ou metade do vermelho) e DPS (2 mono/bi, 3 tri). */
export function aplicarRegrasComponentes(
  sugeridos: Peca[], todos: Peca[], strings: number, ligacao: Ligacao, opts: { aplicarDps?: boolean; aplicarCabos?: boolean } = {},
): { pecas: Peca[]; ajustes: string[] } {
  return aplicarRegrasComponentesLib(sugeridos, todos, strings, ligacao, REGRAS_COMPONENTES_KEROSOLAR, { ...opts, rotulos: ROTULOS_AJUSTE_KEROSOLAR })
}

/**
 * Valor ao cliente (dono, 24/11/2026): a API devolve o CUSTO → TOTAL (produtos + frete + seguro) × 1,6 + transformador.
 */
export function valorAoCliente(total: number, transformador = 0): number {
  return valorAoClienteLib(total, PRECO_KEROSOLAR.multiplicador, transformador)
}

// ── Destino do frete (regra do dono: município do lead; sem ele → Rio de Janeiro - RJ) ─────────
export const DESTINO_PADRAO = { cidade: 'Rio de Janeiro', uf: 'RJ' }
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

/** Cidade/UF do lead ("Niterói", "Niterói - RJ", "Niterói/RJ" + uf/estado separado). null se não houver. */
export function lerDestino(cidade: unknown, uf?: unknown): { cidade: string; uf: string } | null {
  let c = String(cidade ?? '').trim()
  let u = String(uf ?? '').trim().toUpperCase()
  const m = /^(.+?)\s*[-/,]\s*([A-Za-z]{2})$/.exec(c)
  if (m) { c = m[1].trim(); if (!u) u = m[2].toUpperCase() }
  if (!c) return null
  if (!UFS.includes(u)) u = 'RJ' // a KeroSolar atende o Estado do RJ (agent.ts): cidade sem UF → RJ
  return { cidade: c, uf: u }
}

// ── Dados do cliente (contato + customFields do lead/contato) ─────────────────
// Chaves REAIS gravadas hoje no projeto: contact.name/phone/email (engine.ts grava e-mail e nome digitado) e
// lead.customFields.city/state (IA, engine.ts) + roofType/medidor. Endereço/CEP/nome completo ainda não são gravados
// em campo próprio (a coleta do financiamento fica só na conversa) — o leitor aceita as chaves prováveis para quando
// existirem (cep, endereco/logradouro/rua, numero, bairro, complemento, nomeCompleto, email). Ausente = não usa.
export type DadosCliente = {
  nome: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  endereco: { rua?: string; numero?: string; bairro?: string; complemento?: string } | null
  cep: string | null
}

const txtCampo = (...vs: unknown[]): string | null => {
  for (const v of vs) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

export function formatarCep(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null
}

export function lerDadosCliente(
  contato: { name?: string | null; phone?: string | null; whatsappId?: string | null; email?: string | null; customFields?: unknown } | null | undefined,
  leadCf: Record<string, unknown> | null | undefined,
): DadosCliente {
  const cc = ehObj(contato?.customFields) ? (contato!.customFields as Obj) : {}
  const lf = leadCf ?? {}
  const v = (...ks: string[]) => txtCampo(...ks.map((k) => lf[k]), ...ks.map((k) => cc[k]))
  const emailBruto = txtCampo(contato?.email) ?? v('email', 'eMail', 'emailCliente')
  const email = emailBruto && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto) ? emailBruto : null
  const rua = v('logradouro', 'rua', 'endereco', 'address')
  const numero = v('numero', 'numeroEndereco')
  const bairro = v('bairro')
  const complemento = v('complemento')
  const endereco = rua || bairro ? {
    ...(rua ? { rua } : {}), ...(numero ? { numero } : {}), ...(bairro ? { bairro } : {}), ...(complemento ? { complemento } : {}),
  } : null
  return {
    nome: v('nomeCompleto', 'nome_completo') ?? txtCampo(contato?.name),
    telefone: txtCampo(contato?.phone, contato?.whatsappId) ?? v('telefone', 'celular'),
    email,
    cidade: v('cidade', 'municipio', 'city'),
    uf: v('uf', 'estado', 'state'),
    endereco,
    cep: formatarCep(v('cep', 'CEP', 'zip')),
  }
}

/** "Rua X, 37 - Centro" (só o que existir). */
export function linhaEndereco(e: DadosCliente['endereco']): string | null {
  if (!e) return null
  const ruaNum = [e.rua, e.numero].filter(Boolean).join(', ')
  return [ruaNum, e.complemento, e.bairro].filter(Boolean).join(' - ') || null
}

// ── Resultado ────────────────────────────────────────────────────────────────
export type ResultadoCotacao = {
  potenciaPedidaKwp: number
  modulo: Peca & { potenciaW: number; potenciaKitKwp: number | null }
  inversor: Peca & { potenciaKw: number; ligacao: string; tensao: string }
  estrutura: Peca[]
  componentesCC: Peca[]
  componentesCA: Peca[]
  strings: number
  avisos: string[]
  ajustes: string[]
  totalProdutos: number | null
  /** Etapa 6 (Confirmar): números da cotação WEB-xxxxxxx; null se não chegou a ler o total. */
  confirmacao?: Confirmacao | null
  /** Medidor monofásico → transformador somado ao valor do cliente (linha separada). */
  transformador?: number
  /** Valor ao cliente = TOTAL da Belenus × 1,6 + transformador. */
  valorCliente?: number | null
  /** Fase 4: cotação salva em "Meus orçamentos" da Belenus (garante o preço por 3 dias). null = não salvou. */
  cotacaoSalva?: { numeroWeb: string | null; validaAte: string } | null
  /** Estrutura escolhida (para o PDF do orçamento). */
  layoutEstrutura?: { telhado: string; grupo: string; subGrupo: string; linhas: number; modulosPorLinha: number; orientacao: string }
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function linhaPeca(p: Peca): string {
  const preco = p.preco != null ? ` — ${brl(p.preco)}/un` : ''
  const aj = p.ajuste ? ` [${p.ajuste}]` : ''
  return `• ${p.qtde} × ${p.descricao || '(sem descrição)'} (cód. ${p.codigo || '?'})${preco}${aj}`
}

/** Soma preço × quantidade se TODAS as peças tiverem preço; senão null. */
export function totalSeTiverPreco(pecas: Peca[]): number | null {
  if (!pecas.length || pecas.some((p) => p.preco == null)) return null
  return Math.round(pecas.reduce((s, p) => s + (p.preco ?? 0) * p.qtde, 0) * 100) / 100
}

export function textoNota(r: ResultadoCotacao): string {
  const l: string[] = []
  const c = r.confirmacao
  l.push(`🤖 Cotação Belenus${c?.numeroCotacao ? ` ${c.numeroCotacao}` : ''} para ${r.potenciaPedidaKwp.toLocaleString('pt-BR')} kWp — nada foi enviado ao cliente; nenhum pedido foi finalizado.`)
  l.push('')
  l.push(`MÓDULO: ${r.modulo.qtde} × ${r.modulo.descricao} (cód. ${r.modulo.codigo}, ${r.modulo.potenciaW} W)` +
    (r.modulo.potenciaKitKwp ? ` → ${r.modulo.potenciaKitKwp.toLocaleString('pt-BR')} kWp` : '') +
    (r.modulo.preco != null ? ` — ${brl(r.modulo.preco)}/un` : ''))
  l.push(`INVERSOR: ${r.inversor.qtde} × ${r.inversor.descricao} (cód. ${r.inversor.codigo}, ${r.inversor.potenciaKw.toLocaleString('pt-BR')} kW, ${r.inversor.ligacao} ${r.inversor.tensao})` +
    (r.inversor.preco != null ? ` — ${brl(r.inversor.preco)}/un` : ''))
  l.push(`STRINGS: ${r.strings} (${PAINEIS_POR_STRING} painéis por string)`)
  l.push('', 'ESTRUTURA:', ...(r.estrutura.length ? r.estrutura.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('', 'COMPONENTES CC:', ...(r.componentesCC.length ? r.componentesCC.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('', 'COMPONENTES CA:', ...(r.componentesCA.length ? r.componentesCA.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('')
  if (c) {
    l.push(`VALORES DA BELENUS${c.numeroCotacao ? ` (cotação ${c.numeroCotacao})` : ''}:`)
    l.push(`• Produtos: ${brl(c.totalProdutos)}`)
    l.push(c.frete != null ? `• Frete (${c.freteDescricao ?? 'frete'}): ${brl(c.frete)}` : '• Frete: NÃO calculado — fica para o operador (ver avisos)')
    l.push(c.seguro != null ? `• Seguro: ${brl(c.seguro)}` : '• Seguro: não veio')
    for (const i of c.impostos) l.push(`• ${i.nome}: ${brl(i.valor)}`)
    if (c.valorTotalNF != null && Math.abs(c.valorTotalNF - c.total) > 0.01) l.push(`• Valor total NF (informado pela Belenus): ${brl(c.valorTotalNF)}`)
    l.push(`• TOTAL BELENUS: ${brl(c.total)}${c.frete == null ? ' (sem frete)' : ''}`)
    if (c.pagamento) l.push(`• Condição de pagamento na cotação: ${c.pagamento}`)
    l.push('')
    if (r.transformador) l.push(`TRANSFORMADOR (medidor monofásico): ${brl(r.transformador)}`)
    if (r.valorCliente != null) l.push(`VALOR AO CLIENTE: ${brl(r.valorCliente)} (total da Belenus × 1,6 de margem${r.transformador ? ' + transformador' : ''})`)
  } else {
    l.push(r.totalProdutos != null
      ? `TOTAL DOS PRODUTOS (pela API): ${brl(r.totalProdutos)} — sem frete/seguro.`
      : 'PREÇO/TOTAL: não consegui ler o total na Confirmação da Belenus (ver avisos).')
  }
  if (r.cotacaoSalva) l.push('', `✅ Cotação salva na Belenus: ${r.cotacaoSalva.numeroWeb ?? '(número não veio)'} — preço garantido por 3 dias, até ${r.cotacaoSalva.validaAte}.`)
  else if (r.cotacaoSalva === null) l.push('', '⚠️ Não consegui salvar na Belenus — preço não garantido; gere à mão.')
  if (r.ajustes.length) l.push('', 'AJUSTES PELA REGRA DO DONO:', ...r.ajustes.map((a) => `• ${a}`))
  if (r.avisos.length) l.push('', 'AVISOS:', ...r.avisos.map((a) => `⚠️ ${a}`))
  return l.join('\n')
}
