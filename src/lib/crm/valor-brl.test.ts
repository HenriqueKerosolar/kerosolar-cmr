import { describe, expect, it } from 'vitest'
import { lerValorBRL } from './valor-brl'

describe('lerValorBRL', () => {
  it('formatos comuns', () => {
    expect(lerValorBRL('12500')).toBe(12500)
    expect(lerValorBRL('12.500')).toBe(12500)
    expect(lerValorBRL('12.500,50')).toBe(12500.5)
    expect(lerValorBRL('R$ 9.870,00')).toBe(9870)
    expect(lerValorBRL('8073.5')).toBe(8073.5)
    expect(lerValorBRL('1.234.567')).toBe(1234567)
  })
  it('inválidos', () => {
    expect(lerValorBRL('')).toBeNull()
    expect(lerValorBRL('abc')).toBeNull()
    expect(lerValorBRL('0')).toBeNull()
  })
})
