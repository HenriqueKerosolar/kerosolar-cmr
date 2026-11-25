import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { escolherReferencia, faixaDe, orcamentoDaReferencia, type Referencia } from './banco'
import type { ResultadoCotacao } from './regras'

const res = (placas: number, valor: number, telhado = 'colonial', transf?: number) => ({
  modulo: { qtde: placas }, estrutura: [{ codigo: 'GANCHO', descricao: 'SUPORTE GANCHO COLONIAL', qtde: 5 }],
  layoutEstrutura: { telhado, grupo: '', subGrupo: '', linhas: 1, modulosPorLinha: 8, orientacao: 'Retrato' },
  valorCliente: valor, transformador: transf, avisos: [], ajustes: [], cotacaoSalva: { numeroWeb: 'WEB-1', validaAte: '' },
}) as unknown as ResultadoCotacao
const ref = (placas: number, valorBase: number, criadoEm: string, faixa = 'normal'): Referencia =>
  ({ faixa, placas, criadoEm, numeroWeb: 'WEB-1', valorBase, resultado: res(placas, valorBase) })

describe('banco de referência (dono, 24/11/2026)', () => {
  it('faixa: medidor mono separado dos demais; micro separado', () => {
    expect(faixaDe({ ligacao: 'monofásico' })).toBe('mono')
    expect(faixaDe({ ligacao: 'trifásico' })).toBe('normal')
    expect(faixaDe({ ligacao: null, micro: true })).toBe('normal-micro')
  })
  it('mesmo nº de placas primeiro; senão o mais próximo até ±1; nunca de outra faixa', () => {
    const b = { a: ref(7, 100, '2026-11-20'), b: ref(8, 200, '2026-11-24'), c: ref(7, 300, '2026-11-24', 'mono') }
    expect(escolherReferencia(b, 'normal', 7)?.valorBase).toBe(100)
    expect(escolherReferencia(b, 'normal', 9)?.valorBase).toBe(200)
    expect(escolherReferencia(b, 'normal', 10)).toBeNull()
    expect(escolherReferencia(b, 'mono', 8)?.valorBase).toBe(300)
  })
  it('reaproveita: mantém o valor, troca a estrutura se o telhado mudou e soma o transformador do medidor mono', () => {
    const r = orcamentoDaReferencia(ref(7, 11929.82, '2026-11-24'), { kwp: 4.3, telhado: 'metálico', ligacao: 'bifásico' }, 600)
    expect(r.valorCliente).toBe(11929.82)
    expect(r.estrutura).toHaveLength(1)
    expect(r.estrutura[0].descricao).toMatch(/METÁLICO \(8 MÓDULOS\)/)
    expect(r.layoutEstrutura?.telhado).toBe('metálico')
    expect(r.cotacaoSalva).toBeNull()
    const m = orcamentoDaReferencia(ref(7, 11929.82, '2026-11-24'), { kwp: 4.3, ligacao: 'monofásico' }, 600)
    expect(m.valorCliente).toBe(12529.82)
    expect(m.estrutura[0].descricao).toMatch(/COLONIAL/)
  })
})
