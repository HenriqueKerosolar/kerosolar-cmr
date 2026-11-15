import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/dal', () => ({ verifySession: vi.fn().mockResolvedValue({ userId: 'u1' }) }))
const enterStage = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/crm/flow', () => ({ dispatchOutbound: vi.fn(), enterStage }))
vi.mock('@/lib/crm/capi', () => ({ sendCapiEvent: vi.fn().mockResolvedValue(true) }))

const leadFindUnique = vi.fn()
const leadUpdate = vi.fn().mockResolvedValue(undefined)
const stageFindUnique = vi.fn()
const noteCreate = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findUnique: leadFindUnique, update: leadUpdate },
    stage: { findUnique: stageFindUnique },
    note: { create: noteCreate },
  },
}))

const WON_STAGE = { id: 'stage-won', name: 'Fechou', isWon: true, isLost: false }
const LOST_STAGE = { id: 'stage-lost', name: 'Perdido', isWon: false, isLost: true }
const OPEN_STAGE = { id: 'stage-open', name: 'Negociando', isWon: false, isLost: false }

// O desfecho para o Mind Marketing (lead.qualified / won / lost) sai no enterStage — testado em
// src/lib/nervo/leadOutcome.test.ts. Aqui: a troca de etapa grava o status certo e chama o enterStage.
describe('moveLeadStage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('etapa de venda ganha → status won e entra na etapa (que publica o desfecho)', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead1', stageId: 'stage-open', value: 1500, contact: { phone: '5511999998888', ctwaClid: null } })
    stageFindUnique.mockResolvedValue(WON_STAGE)
    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead1', 'stage-won')
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead1' }, data: expect.objectContaining({ stageId: 'stage-won', status: 'won' }) }))
    expect(enterStage).toHaveBeenCalledWith('lead1', 'stage-won')
  })

  it('etapa perdida → status lost', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead2', stageId: 'stage-open', value: 0 })
    stageFindUnique.mockResolvedValue(LOST_STAGE)
    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead2', 'stage-lost')
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'lost' }) }))
    expect(enterStage).toHaveBeenCalledWith('lead2', 'stage-lost')
  })

  it('etapa comum → status open (sai do ganho/perdido)', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead3', stageId: 'stage-won', value: 0 })
    stageFindUnique.mockResolvedValue(OPEN_STAGE)
    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead3', 'stage-open')
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'open', closedAt: null }) }))
  })

  it('mesma etapa → não faz nada', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead4', stageId: 'stage-open', value: 0 })
    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead4', 'stage-open')
    expect(leadUpdate).not.toHaveBeenCalled()
    expect(enterStage).not.toHaveBeenCalled()
  })
})
