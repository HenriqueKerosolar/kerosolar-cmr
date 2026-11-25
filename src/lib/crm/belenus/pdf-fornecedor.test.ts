import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('../ai', () => ({ loadAiConfig: vi.fn(), extractJson: vi.fn() }))
import { lerComandoOrcaEsse, margemDe, resultadoDoFornecedor, type OrcamentoFornecedor } from './pdf-fornecedor'

const hib: OrcamentoFornecedor = {
  hibrido: true, total: 30000, fornecedor: 'X',
  itens: [
    { tipo: 'modulo', descricao: 'MODULO 610W', qtde: 10, potenciaW: 610 },
    { tipo: 'inversor', descricao: 'INVERSOR HIBRIDO 6KW', qtde: 1, potenciaKw: 6 },
    { tipo: 'bateria', descricao: 'BATERIA LITIO 5KWH', qtde: 2 },
    { tipo: 'estrutura', descricao: 'PERFIL ALUMINIO', qtde: 8 },
    { tipo: 'outro', descricao: 'CABO SOLAR 6MM', qtde: 50, unidade: 'M' },
  ],
}

describe('PDF do fornecedor → orçamento KeroSolar (dono, 24/11/2026)', () => {
  it('comando "orça esse" (legenda inteira), com margem opcional', () => {
    expect(lerComandoOrcaEsse('orça esse')).toEqual({ margem: null })
    expect(lerComandoOrcaEsse('Orca este 45%')).toEqual({ margem: 0.45 })
    expect(lerComandoOrcaEsse('orçar esse com 50 %')).toEqual({ margem: 0.5 })
    expect(lerComandoOrcaEsse('segue o orçamento')).toBeNull()
    expect(lerComandoOrcaEsse('')).toBeNull()
  })
  it('margem: híbrido 50%, on-grid 60%, ou a do comando', () => {
    expect(margemDe(hib, null)).toBe(0.5)
    expect(margemDe({ ...hib, hibrido: false }, null)).toBe(0.6)
    expect(margemDe(hib, 0.4)).toBe(0.4)
  })
  it('monta o resultado: total × (1 + margem), kit pelos módulos, bateria nos componentes', () => {
    const r = resultadoDoFornecedor(hib, 0.5, null)
    expect(r.valorCliente).toBe(45000)
    expect(r.modulo.qtde).toBe(10)
    expect(r.modulo.potenciaW).toBe(610)
    expect(r.inversor.descricao).toMatch(/HIBRIDO/)
    expect(r.componentesCC.map((p) => p.descricao)).toContain('BATERIA LITIO 5KWH')
    expect(r.estrutura).toHaveLength(1)
    expect(r.layoutEstrutura?.telhado).toBe('colonial')
  })
  it('sem total ou sem painéis → erro claro (nada é gerado)', () => {
    expect(() => resultadoDoFornecedor({ ...hib, total: null }, 0.5, null)).toThrow(/VALOR TOTAL/)
    expect(() => resultadoDoFornecedor({ ...hib, itens: hib.itens.slice(1) }, 0.5, null)).toThrow(/painéis/)
  })
})
