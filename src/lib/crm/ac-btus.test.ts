import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { extrairBtus, extrairAc, consumoAcKwhMes } from './ac-calc'

describe('ar-condicionado com vários BTUs (Jonni, 24/11/2026)', () => {
  it('"7500 ou 9000" são alternativas', () => {
    expect(extrairBtus('gostaria de vê uma proposta para a casa toda! Incluindo: 2 ar condicionados de 7500 ou 9000 btus.')).toEqual({ btus: [7500, 9000], alternativas: true })
  })
  it('"7500 e 9000" são aparelhos diferentes', () => {
    expect(extrairBtus('+ 2 ar condicionados para 12/dia. De 7500 e 9000 BTUs!.').alternativas).toBe(false)
  })
  it('não confunde CEP, telefone nem medidas', () => {
    expect(extrairBtus('Cep: 23032110. Telhado tipo Eternit 3,66x110').btus).toEqual([])
  })
  it('lê quantidade e horas', () => {
    expect(extrairAc('Gostaria de vê as propostas para Casa toda. 2 ar condicionados 12h/ dia. De de 7500 BTUs e 9000 .')).toEqual(expect.objectContaining({ units: 2, hoursPerDay: 12 }))
  })
  it('consumo pela regra (BTU abaixo da tabela × 1,94 × horas)', () => {
    expect(consumoAcKwhMes(7500, 12)).toBe(163) // 7000 → 7 × 1,94 × 12
    expect(consumoAcKwhMes(9000, 12)).toBe(210)
  })
})
