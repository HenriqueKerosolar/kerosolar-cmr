import { describe, it, expect } from 'vitest'
import { pedeOnGrid, pedeHibrido } from './solar-calc'

describe('on grid x híbrido (Valessa, 23/11/2026)', () => {
  it('reconhece pedido on grid', () => {
    expect(pedeOnGrid('Gostaria de saber sobre instalação on grid - 600 a 700 kWh/mês')).toBe(true)
    expect(pedeOnGrid('quero ongrid')).toBe(true)
    expect(pedeOnGrid('sistema sem bateria')).toBe(true)
  })
  it('híbrido não é on grid', () => {
    expect(pedeOnGrid('Tem híbrido?')).toBe(false)
    expect(pedeHibrido('Tem híbrido?')).toBe(true)
    expect(pedeOnGrid('on grid ou híbrido, qual compensa?')).toBe(false)
  })
})
