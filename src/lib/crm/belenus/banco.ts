import 'server-only'
// 🗂️ Banco de orçamentos de referência (dono, 24/11/2026). Toda cotação da Belenus que deu certo fica guardada por
// FAIXA (medidor mono × demais, micro ou não) e NÚMERO DE PLACAS. Um orçamento novo no mesmo kWp SUBSTITUI o antigo
// (fica valendo o mais recente como referência). Quando a Belenus não está ao alcance (nenhum CRM aberto no
// navegador) ou falha, o orçamento sai do banco: mesmo kWp ou o mais próximo (±1 placa), trocando só os dados do
// cliente e o tipo de estrutura, mantendo o valor. Guardado em SystemConfig `belenus_banco` (JSON).

import { prisma } from '@/lib/prisma'
import { ESTRUTURA_DE_N_PAINEIS, type Peca, type ResultadoCotacao } from './regras'
import type { EntradaCotacao } from './cotar'

const CHAVE = 'belenus_banco'
/** Tolerância de "muito próximo": até 1 placa a mais ou a menos. */
export const TOLERANCIA_PLACAS = 1

export type Referencia = {
  faixa: string
  placas: number
  criadoEm: string
  numeroWeb: string | null
  /** valor ao cliente SEM o transformador (o transformador é somado de novo conforme o medidor do novo cliente) */
  valorBase: number
  resultado: ResultadoCotacao
}
type Banco = Record<string, Referencia>

export function faixaDe(e: Pick<EntradaCotacao, 'ligacao' | 'micro'>): string {
  return `${e.ligacao === 'monofásico' ? 'mono' : 'normal'}${e.micro ? '-micro' : ''}`
}
const placasDe = (r: ResultadoCotacao) => Number(r.modulo?.qtde) || 0

async function lerBanco(): Promise<Banco> {
  try {
    const c = await prisma.systemConfig.findUnique({ where: { key: CHAVE } })
    const b = c?.value ? JSON.parse(c.value) : {}
    return b && typeof b === 'object' ? b as Banco : {}
  } catch { return {} }
}

/** Guarda (ou substitui) a referência desta faixa/quantidade de placas. Nunca lança. */
export async function guardarReferencia(entrada: EntradaCotacao, r: ResultadoCotacao, agora = new Date()): Promise<void> {
  try {
    const placas = placasDe(r)
    if (!(placas > 0) || !(Number(r.valorCliente) > 0)) return
    const faixa = faixaDe(entrada)
    const banco = await lerBanco()
    const resultado: ResultadoCotacao = JSON.parse(JSON.stringify(r))
    banco[`${faixa}:${placas}`] = {
      faixa, placas, criadoEm: agora.toISOString(), numeroWeb: r.cotacaoSalva?.numeroWeb ?? null,
      valorBase: Math.round((Number(r.valorCliente) - (r.transformador ?? 0)) * 100) / 100, resultado,
    }
    const value = JSON.stringify(banco)
    await prisma.systemConfig.upsert({ where: { key: CHAVE }, update: { value }, create: { key: CHAVE, value } })
  } catch (e) {
    console.error('[belenus banco] não guardou:', e instanceof Error ? e.message : e)
  }
}

/** Escolhe a referência: mesma quantidade de placas; senão a mais próxima até ±1 placa (empate → a mais recente). */
export function escolherReferencia(banco: Banco, faixa: string, placasAlvo: number): Referencia | null {
  const candidatas = Object.values(banco)
    .filter((r) => r.faixa === faixa && Math.abs(r.placas - placasAlvo) <= TOLERANCIA_PLACAS)
    .sort((a, b) => Math.abs(a.placas - placasAlvo) - Math.abs(b.placas - placasAlvo) || b.criadoEm.localeCompare(a.criadoEm))
  return candidatas[0] ?? null
}

const ROTULO_TELHADO: Record<string, string> = {
  colonial: 'CERÂMICO/COLONIAL', fibrocimento: 'FIBROCIMENTO', 'metálico': 'METÁLICO', laje: 'LAJE', solo: 'SOLO',
}

/**
 * Orçamento a partir da referência: mesmo kit e mesmo valor; troca o tipo de estrutura (se o telhado for outro) e
 * o transformador conforme o medidor do novo cliente. Os dados do cliente entram depois, no PDF (vêm do lead).
 */
export function orcamentoDaReferencia(ref: Referencia, entrada: EntradaCotacao, transformadorPreco: number): ResultadoCotacao {
  const r: ResultadoCotacao = JSON.parse(JSON.stringify(ref.resultado))
  const telhado = entrada.telhado ?? 'colonial'
  if (r.layoutEstrutura && r.layoutEstrutura.telhado !== telhado) {
    const placasEstrutura = Math.ceil(ref.placas / ESTRUTURA_DE_N_PAINEIS) * ESTRUTURA_DE_N_PAINEIS
    const generica: Peca = {
      codigo: 'ESTRUTURA', descricao: `ESTRUTURA DE FIXAÇÃO EM ALUMÍNIO PARA TELHADO ${ROTULO_TELHADO[telhado] ?? telhado.toUpperCase()} (${placasEstrutura} MÓDULOS)`,
      qtde: 1, preco: null,
    } as Peca
    r.estrutura = [generica]
    r.layoutEstrutura = { ...r.layoutEstrutura, telhado }
  }
  const mono = entrada.ligacao === 'monofásico'
  r.transformador = mono ? transformadorPreco : undefined
  r.valorCliente = Math.round((ref.valorBase + (mono ? transformadorPreco : 0)) * 100) / 100
  r.cotacaoSalva = null
  const data = new Date(ref.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  r.avisos = [
    `Orçamento do BANCO DE REFERÊNCIA (Belenus fora do alcance): kit de ${ref.placas} placas cotado em ${data}${ref.numeroWeb ? ` (${ref.numeroWeb})` : ''}, valor mantido. Confira o preço na Belenus antes de fechar.`,
    ...(!entrada.telhado ? ['Tipo de telhado não informado: estrutura CERÂMICO/COLONIAL (regra do dono).'] : []),
  ]
  r.ajustes = []
  return r
}

/** Busca no banco para esta entrada (placas pela fórmula do kWp). null = não há referência próxima. */
export async function buscarReferencia(entrada: EntradaCotacao, placasAlvo: number): Promise<Referencia | null> {
  return escolherReferencia(await lerBanco(), faixaDe(entrada), placasAlvo)
}
