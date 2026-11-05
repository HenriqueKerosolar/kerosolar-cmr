import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/dal', () => ({ verifySession: vi.fn().mockResolvedValue({ userId: 'u1' }) }))
vi.mock('@/lib/crm/flow', () => ({ dispatchOutbound: vi.fn(), enterStage: vi.fn().mockResolvedValue(undefined) }))
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

const publishLeadWon = vi.fn().mockResolvedValue(undefined)
const publishLeadLost = vi.fn().mockResolvedValue(undefined)
const getCrmNervo = vi.fn().mockReturnValue({ publishLeadWon, publishLeadLost })
vi.mock('@/lib/nervo/fromEnv', () => ({ getCrmNervo }))

const WON_STAGE = { id: 'stage-won', name: 'Fechado', isWon: true, isLost: false }
const LOST_STAGE = { id: 'stage-lost', name: 'Perdido', isWon: false, isLost: true }
const OPEN_STAGE = { id: 'stage-open', name: 'Negociando', isWon: false, isLost: false }

describe('moveLeadStage — publicação no Nervo (lead.won / lead.lost)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCrmNervo.mockReturnValue({ publishLeadWon, publishLeadLost })
  })

  it('ao mover para etapa isWon, publica lead.won com o valor do lead e o telefone do contato', async () => {
    // mesmo objeto atende a leitura inicial (stageId diferente do destino) E os re-fetches (CAPI, Nervo).
    leadFindUnique.mockResolvedValue({ id: 'lead1', stageId: 'stage-open', value: 1500, contact: { phone: '5511999998888', ctwaClid: null } })
    stageFindUnique.mockResolvedValue(WON_STAGE)

    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead1', 'stage-won')

    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead1' }, data: expect.objectContaining({ stageId: 'stage-won', status: 'won' }) }))
    expect(publishLeadWon).toHaveBeenCalledWith({ leadId: 'lead1', contactPhone: '5511999998888', valueReais: 1500 })
    expect(publishLeadLost).not.toHaveBeenCalled()
  })

  it('ao mover para etapa isLost, publica lead.lost sem valor', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead2', stageId: 'stage-open', value: 0, contact: { phone: null, ctwaClid: null } })
    stageFindUnique.mockResolvedValue(LOST_STAGE)

    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead2', 'stage-lost')

    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'lost' }) }))
    expect(publishLeadLost).toHaveBeenCalledWith({ leadId: 'lead2', contactPhone: null })
    expect(publishLeadWon).not.toHaveBeenCalled()
  })

  it('não publica nada quando a etapa de destino não é ganha nem perdida', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead3', stageId: 'stage-won', value: 0 })
    stageFindUnique.mockResolvedValue(OPEN_STAGE)

    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead3', 'stage-open')

    expect(publishLeadWon).not.toHaveBeenCalled()
    expect(publishLeadLost).not.toHaveBeenCalled()
    expect(leadUpdate).toHaveBeenCalled() // a troca de estágio em si aconteceu normalmente
  })

  it('falha do Nervo (erro de rede/config) nunca impede a troca de estágio no banco', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead4', stageId: 'stage-open', value: 500, contact: { phone: '5511999998888', ctwaClid: null } })
    stageFindUnique.mockResolvedValue(WON_STAGE)
    getCrmNervo.mockReturnValue({
      publishLeadWon: vi.fn().mockRejectedValue(new Error('falha inesperada')),
      publishLeadLost,
    })

    const { moveLeadStage } = await import('./lead')
    await expect(moveLeadStage('lead4', 'stage-won')).resolves.toBeUndefined()

    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'won' }) }))
    expect(noteCreate).toHaveBeenCalled()
  })

  it('sem Nervo configurado (getCrmNervo devolve undefined), a troca de estágio segue normal', async () => {
    leadFindUnique.mockResolvedValue({ id: 'lead5', stageId: 'stage-open', value: 0 })
    stageFindUnique.mockResolvedValue(LOST_STAGE)
    getCrmNervo.mockReturnValue(undefined)

    const { moveLeadStage } = await import('./lead')
    await moveLeadStage('lead5', 'stage-lost')

    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'lost' }) }))
    expect(publishLeadLost).not.toHaveBeenCalled()
  })
})
