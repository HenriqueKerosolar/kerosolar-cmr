import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { lerComandoSimulacao } from './comando-indicacao'
import { simulacaoCartaoTexto, simulacaoFinanciamentoTexto } from './solar-calc'

describe('comandos "simula financiamento" e "simula cartão" (24/11/2026)', () => {
  it('lê financiamento', () => {
    expect(lerComandoSimulacao('simula financiamento valor 30.000')).toEqual({ tipo: 'financiamento', valor: 30000 })
    expect(lerComandoSimulacao('Simula financiamento de R$ 30.000,50')).toEqual({ tipo: 'financiamento', valor: 30000.5 })
    expect(lerComandoSimulacao('simula financiamento 25 mil')).toEqual({ tipo: 'financiamento', valor: 25000 })
    expect(lerComandoSimulacao('simula financiamento valor de 1,5 mil')).toEqual({ tipo: 'financiamento', valor: 1500 })
    expect(lerComandoSimulacao('Simula financiamento de R$  14.579,54')).toEqual({ tipo: 'financiamento', valor: 14579.54 })
    expect(lerComandoSimulacao('simula financiamento valor R$ 14.579,54')).toEqual({ tipo: 'financiamento', valor: 14579.54 })
    expect(lerComandoSimulacao('Simula financiamento valor 14579,54')).toEqual({ tipo: 'financiamento', valor: 14579.54 })
  })
  it('lê cartão', () => {
    expect(lerComandoSimulacao('Simula cartão de R$ 15.000')).toEqual({ tipo: 'cartao', valor: 15000 })
    expect(lerComandoSimulacao('simula cartao 8073')).toEqual({ tipo: 'cartao', valor: 8073 })
    expect(lerComandoSimulacao('simula cartão de crédito de R$ 10.000,00')).toEqual({ tipo: 'cartao', valor: 10000 })
  })
  it('sem valor dá erro; outra frase não é comando', () => {
    expect(lerComandoSimulacao('simula financiamento')).toHaveProperty('erro')
    expect(lerComandoSimulacao('simula cartão pra ela')).toHaveProperty('erro')
    expect(lerComandoSimulacao('vou simular o financiamento e te mando')).toBeNull()
    expect(lerComandoSimulacao('faz 600 kwh')).toBeNull()
  })
  it('cartão vai de 2x a 24x', () => {
    const t = simulacaoCartaoTexto(10000)
    expect(t).toContain('• *2x de R$ 5.000,00* _(sem juros)_')
    expect(t).toContain('• *24x de')
    expect(t).not.toContain('• *1x de')
  })
  it('financiamento mostra os prazos da tabela', () => {
    const t = simulacaoFinanciamentoTexto(20870)
    expect(t).toContain('24x de')
    expect(t).toContain('96x de')
  })
})
