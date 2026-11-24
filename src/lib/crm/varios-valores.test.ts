import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { extrairVariosValores, extrairConsumo } from './solar-calc'

describe('valor da conta com palavras no meio (Harry)', () => {
  it('"conta que gira entorno de 500/600,00" → R$ 500', () => {
    expect(extrairConsumo('Gostaria de orçamento para uma conta que gira entorno de 500/600,00\n\nEm quantas parcelas?').reais).toBe(500)
    expect(extrairConsumo('minha conta de luz fica por volta de 350').reais).toBe(350)
  })
})

describe('vários valores no mesmo pedido → um orçamento para cada, menor primeiro (Harry, 24/11/2026)', () => {
  it('reais', () => {
    expect(extrairVariosValores('Gostaria de orçamento para uma conta que gira entorno de 500/600,00')).toEqual({ tipo: 'reais', valores: [500, 600] })
    expect(extrairVariosValores('minha conta vem 600 ou 500 reais')).toEqual({ tipo: 'reais', valores: [500, 600] })
    expect(extrairVariosValores('conta entre R$ 450 e R$ 700')).toEqual({ tipo: 'reais', valores: [450, 700] })
    expect(extrairVariosValores('faz pra 400, 600 e 800')).toEqual({ tipo: 'reais', valores: [400, 600, 800] })
  })
  it('kWh', () => {
    expect(extrairVariosValores('consumo de 500 a 700 kwh')).toEqual({ tipo: 'kwh', valores: [500, 700] })
    expect(extrairVariosValores('600 a 700 kWh/mês')).toEqual({ tipo: 'kwh', valores: [600, 700] })
  })
  it('um valor só não é "vários"', () => {
    expect(extrairVariosValores('minha conta é 500')).toBeNull()
    expect(extrairVariosValores('Em quantas parcelas?')).toBeNull()
  })
})
