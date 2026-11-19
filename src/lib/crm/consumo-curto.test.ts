import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { extrairConsumo } = await import('./solar-calc')

// Regra do dono (18/11/2026): mandou o valor → responde com o orçamento, a qualquer horário.
// "700kw" / "700k" = consumo em kWh; "700" puro = valor da conta em reais.
describe('extrairConsumo — respostas curtas do cliente', () => {
  it('700kw / 700k / 700 kwh → kWh', () => {
    for (const t of ['700kw', '700k', '700 kwh', '700KW']) expect(extrairConsumo(t)).toEqual({ kwh: 700 })
  })
  it('número puro → reais', () => {
    expect(extrairConsumo('700')).toEqual({ reais: 700 })
    expect(extrairConsumo('700,00')).toEqual({ reais: 700 })
    expect(extrairConsumo('1.200')).toEqual({ reais: 1200 })
    expect(extrairConsumo('R$ 450')).toEqual({ reais: 450 })
  })
  it('conversa comum não vira valor', () => {
    expect(extrairConsumo('oi, bom dia')).toEqual({})
    expect(extrairConsumo('tenho 2 filhos')).toEqual({})
    expect(extrairConsumo('5')).toEqual({})
  })
})
