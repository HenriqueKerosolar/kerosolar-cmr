// 📄 Orçamento KeroSolar (Fase 3 do robô Belenus) — parte PURA: monta os dados do PDF a partir do kit cotado.
// Modelo aprovado pelo dono (24/11/2026): Orcamento-KeroSolar-Rafael-Dias.pdf (gerar_orcamento.py).
// Regras: SEM preço por item, SEM código da Belenus, SEM "BELENERGY/BELENUS" no nome; "Fabricante:" só no módulo,
// no inversor e no DPS; número próprio KS-AAAAMMDD-XXXX (NUNCA o número WEB da Belenus).

import { getTabelaFinanciamento, parcelaFinanciamento, calcularSolarPorKwh, ajustarValorVenda, valorAVista } from '../solar-calc'
import { simularCartao, MAX_PARCELAS_CARTAO } from '../card-calc'
import { KWH_POR_PAINEL, corDoCabo, ehDps, type Peca, type ResultadoCotacao } from './regras'

export const VALIDADE_DIAS = 3
const FUSO = 'America/Sao_Paulo'

/** Data no fuso de Brasília (o servidor roda em UTC). */
function partesData(d: Date): { a: string; m: string; d: string } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return { a: v('year'), m: v('month'), d: v('day') }
}
export const dataBR = (d: Date) => { const p = partesData(d); return `${p.d}/${p.m}/${p.a}` }

/** "KS-AAAAMMDD-XXXX" (XXXX = 4 últimos caracteres do id do lead). */
export function numeroOrcamentoKS(agora: Date, leadId: string): string {
  const p = partesData(agora)
  const fim = (leadId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase().padStart(4, '0')
  return `KS-${p.a}${p.m}${p.d}-${fim}`
}

/** Orçamento gerado há mais de 3 dias → vencido (regra da validade da proposta). */
export function orcamentoVencido(criadoEm: string | Date, agora = new Date()): boolean {
  const t = new Date(criadoEm).getTime()
  return !Number.isFinite(t) || agora.getTime() - t > VALIDADE_DIAS * 24 * 60 * 60 * 1000
}

/** Tira o nome da distribuidora/marca própria dela do texto do produto. */
export function limparNomeProduto(nome: string): string {
  return (nome || '')
    .replace(/\b(BELENERGY|BEL ENERGY|BELENUS)\b/gi, ' ')
    .replace(/\s*[-–|/]\s*(?=[-–|/]|$)/g, ' ')
    .replace(/^\s*[-–|/]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function tituloFabricante(f?: string): string | undefined {
  const s = limparNomeProduto(f ?? '')
  if (!s) return undefined
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
}

function unidadeDe(p: Peca): string {
  const u = (p.unidade ?? '').trim().toUpperCase()
  if (u && u.length <= 3 && /^[A-Z]+$/.test(u)) return u === 'UN' ? 'PC' : u
  return corDoCabo(p.descricao) ? 'M' : 'PC'
}

const TELHADO_ROTULO: Record<string, { tipo: string; detalhes: string }> = {
  colonial: { tipo: 'Colonial', detalhes: 'Estrutura em alumínio com ajuste vertical, indicada para telhas cerâmicas em geral' },
  fibrocimento: { tipo: 'Fibrocimento', detalhes: 'Estrutura em alumínio para telhas de fibrocimento' },
  'metálico': { tipo: 'Metálico', detalhes: 'Estrutura em alumínio para telhado metálico' },
  laje: { tipo: 'Laje', detalhes: 'Estrutura em alumínio para laje' },
  solo: { tipo: 'Solo', detalhes: 'Estrutura em alumínio para instalação em solo' },
}

export type ProdutoOrcamento = { nome: string; fabricante?: string; qtde: string }
export type DadosOrcamento = {
  numero: string
  emissao: string
  validaAte: string
  cliente: { nome: string; cidadeUf: string; telefone: string; email?: string; endereco?: string; cep?: string }
  kwp: number
  geracaoMes: number
  geracaoAno: number
  estrutura: { tipo: string; detalhes: string; linhas: number; modulosPorLinha: number; orientacao: string }
  produtos: ProdutoOrcamento[]
  valorTotal: number
  valorPix: number
  financiamento: { prazo: number; parcela: number }[]
  cartao: { n: number; parcela: number; semJuros: boolean }[]
  economia: null | { consumoKwh: number; contaHoje: number; mes: number; ano: number; retornoAnos: number; trintaAnos: number }
  observacoes: string[]
  monofasico: boolean
}

export const OBSERVACOES_PADRAO = [
  'Orçamento prévio: o projeto final é confirmado após a vistoria técnica do local (estrutura do telhado, espaço e sombreamento).',
  'Preços dos equipamentos válidos por 3 dias ou enquanto durarem os estoques.',
  'Financiamento sujeito à aprovação de crédito; simulações de cartão e financiamento podem ser atualizadas a qualquer momento.',
  'Os prazos de homologação dependem da concessionária.',
]

export type LeadOrcamento = {
  id: string
  nome?: string | null
  telefone?: string | null
  cidadeUf?: string | null
  consumoKwh?: number | null
  email?: string | null
  endereco?: string | null   // "Rua X, 37 - Bairro" (sem CPF/CNPJ: nunca vai no PDF)
  cep?: string | null
}

function formatarTelefone(t?: string | null): string {
  const d = (t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return (t ?? '').trim() || '—'
}

/**
 * Dados do PDF. A tabela de financiamento usada é a ATIVA (chame `carregarTabelaFinanciamento()` antes).
 * Exige `valorCliente` (o total da Confirmação) — sem ele não há orçamento.
 */
export function montarDadosOrcamento(r: ResultadoCotacao, lead: LeadOrcamento, agora = new Date()): DadosOrcamento {
  const valorTotal = r.valorCliente
  if (valorTotal == null || !(valorTotal > 0)) throw new Error('Sem o valor da Belenus não dá para gerar o PDF do orçamento.')
  const placas = r.modulo.qtde
  const kwp = Math.round((placas * r.modulo.potenciaW) / 10) / 100
  const geracaoMes = placas * KWH_POR_PAINEL
  const monofasico = !!r.transformador

  const produtos: ProdutoOrcamento[] = []
  const add = (p: Peca, comFabricante: boolean) => {
    if (!(p.qtde > 0)) return
    const nome = limparNomeProduto(p.descricao)
    if (!nome) return
    produtos.push({ nome, ...(comFabricante && tituloFabricante(p.fabricante) ? { fabricante: tituloFabricante(p.fabricante) } : {}), qtde: `${p.qtde} ${unidadeDe(p)}` })
  }
  add(r.modulo, true)
  add(r.inversor, true)
  for (const p of r.estrutura) add(p, false)
  for (const p of [...r.componentesCC, ...r.componentesCA]) add(p, ehDps(p.descricao))
  if (monofasico) produtos.push({ nome: 'TRANSFORMADOR', qtde: '1 PC' })

  const tel = r.layoutEstrutura
  const rot = TELHADO_ROTULO[tel?.telhado ?? 'colonial'] ?? TELHADO_ROTULO.colonial

  const tabela = getTabelaFinanciamento()
  const financiamento = Object.keys(tabela).map(Number).sort((a, b) => a - b)
    .map((prazo) => ({ prazo, parcela: Math.round(parcelaFinanciamento(valorTotal, prazo) * 100) / 100 }))
    .filter((f) => f.parcela > 0)
  const cartao: DadosOrcamento['cartao'] = []
  for (let n = 2; n <= MAX_PARCELAS_CARTAO; n++) {
    const s = simularCartao(valorTotal, n)
    if (s) cartao.push({ n, parcela: s.parcela, semJuros: s.semJuros })
  }

  let economia: DadosOrcamento['economia'] = null
  if (lead.consumoKwh && lead.consumoKwh > 0) {
    const e = ajustarValorVenda(calcularSolarPorKwh(lead.consumoKwh), valorTotal)
    economia = { consumoKwh: Math.round(lead.consumoKwh), contaHoje: e.contaReais, mes: e.economiaMensal, ano: e.economiaAnual, retornoAnos: e.paybackAnos, trintaAnos: e.economia30Anos }
  }

  const validade = new Date(agora.getTime() + VALIDADE_DIAS * 24 * 60 * 60 * 1000)
  return {
    numero: numeroOrcamentoKS(agora, lead.id),
    emissao: dataBR(agora),
    validaAte: dataBR(validade),
    cliente: {
      nome: (lead.nome ?? '').trim() || 'Cliente', cidadeUf: (lead.cidadeUf ?? '').trim() || 'Rio de Janeiro - RJ', telefone: formatarTelefone(lead.telefone),
      ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
      ...(lead.endereco?.trim() ? { endereco: lead.endereco.trim() } : {}),
      ...(lead.cep?.trim() ? { cep: lead.cep.trim() } : {}),
    },
    kwp, geracaoMes, geracaoAno: geracaoMes * 12,
    estrutura: { tipo: rot.tipo, detalhes: rot.detalhes, linhas: tel?.linhas ?? 1, modulosPorLinha: tel?.modulosPorLinha ?? placas, orientacao: tel?.orientacao || 'Retrato' },
    produtos,
    valorTotal, valorPix: valorAVista(valorTotal),
    financiamento, cartao, economia,
    observacoes: [...OBSERVACOES_PADRAO, ...(monofasico ? ['Medidor monofásico: inclui transformador.'] : [])],
    monofasico,
  }
}

// ── Comando "envia orçamento" (parte pura) ───────────────────────────────────
/** A mensagem INTEIRA é o comando: "envia orçamento", "envia o orçamento", "enviar orçamento". */
export function lerComandoEnviaOrcamento(text: string): boolean {
  const t = (text || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /^(envia|enviar|envie)\s+(o\s+)?orcamento\s*[.!]?$/.test(t)
}

/** Guardado no lead (customFields.orcamentoBelenus) quando o "cota belenus" gera o PDF. */
export type OrcamentoSalvo = {
  arquivo: string; valorCliente: number; kwp: number; criadoEm: string; numero: string
  /** Fase 4: número WEB da cotação salva na Belenus (só interno — NUNCA vai no PDF do cliente). */
  numeroWeb?: string | null
}

/** Confere o último orçamento do lead antes de enviar: existe e tem no máximo 3 dias. */
export function validarOrcamentoSalvo(o: unknown, agora = new Date()): { ok: OrcamentoSalvo } | { erro: string } {
  const v = o as Partial<OrcamentoSalvo> | null | undefined
  if (!v || typeof v !== 'object' || !v.arquivo || !v.numero || !(Number(v.valorCliente) > 0)) {
    return { erro: 'Esse lead não tem orçamento gerado. Gere com "cota belenus <kWp>" e depois escreva "envia orçamento". Nada foi enviado ao cliente.' }
  }
  if (!v.criadoEm || orcamentoVencido(v.criadoEm, agora)) {
    return { erro: `O orçamento ${v.numero} tem mais de ${VALIDADE_DIAS} dias (vencido): gere de novo com "cota belenus". Nada foi enviado ao cliente.` }
  }
  return { ok: v as OrcamentoSalvo }
}
