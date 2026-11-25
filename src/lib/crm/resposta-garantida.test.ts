import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { ESPERA_MS, precisaSocorro } from './resposta-garantida'

const agora = new Date('2026-11-25T01:40:00Z')
const msg = (minAtras: number, direction = 'inbound', senderType = 'contact') =>
  ({ direction, senderType, createdAt: new Date(agora.getTime() - minAtras * 60_000) })

describe('resposta garantida (dono, 24/11/2026: cliente nunca fica sem resposta)', () => {
  it('mensagem do cliente sem resposta há mais de 5 min → socorre', () => {
    expect(ESPERA_MS).toBe(5 * 60_000)
    expect(precisaSocorro(msg(6), agora)).toBe(true)
  })
  it('ainda dentro do tempo normal (espera de digitação + Belenus) → não mexe', () => {
    expect(precisaSocorro(msg(3), agora)).toBe(false)
  })
  it('última mensagem é nossa (já respondeu) → não mexe', () => {
    expect(precisaSocorro(msg(10, 'outbound', 'ai'), agora)).toBe(false)
  })
  it('muito antiga (> 1 h) → não ressuscita conversa velha', () => {
    expect(precisaSocorro(msg(90), agora)).toBe(false)
  })
})
