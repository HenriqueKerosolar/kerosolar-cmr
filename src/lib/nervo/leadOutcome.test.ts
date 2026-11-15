import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Banco em memória mínimo: 1 lead, o funil da KeroSolar e a conversa.
const db = { lead: { id: 'L1', pipelineId: 'P', customFields: {} as Record<string, unknown>, value: 15000, source: 'instagram', contact: { phone: '5521999990000', adReferral: { source_id: 'AD9' } } } }
const prismaMock = {
  lead: {
    findUnique: vi.fn(async () => db.lead),
    update: vi.fn(async ({ data }: { data: { customFields: Record<string, unknown> } }) => { db.lead.customFields = data.customFields; return db.lead }),
  },
  stage: {
    findMany: vi.fn(async () => funil),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => funil.find((s) => s.id === where.id) ?? null),
  },
  conversation: { findFirst: vi.fn(async () => ({ channel: 'whatsapp' })) },
  note: { create: vi.fn(async () => ({})) },
}
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const chamadas: string[] = []
const nervo = {
  publishLeadQualified: vi.fn(async () => { chamadas.push('qualified'); return 'queued' as const }),
  publishLeadWon: vi.fn(async () => { chamadas.push('won') }),
  publishLeadLost: vi.fn(async () => { chamadas.push('lost') }),
  publishLeadStageReached: vi.fn(async (i: { funnelLevel: string }) => { chamadas.push(`nivel:${i.funnelLevel}`); return 'queued' as const }),
}
vi.mock('./fromEnv', () => ({ getCrmNervo: () => nervo }))

const { etapaQualifica, publicarDesfechoAoEntrar } = await import('./leadOutcome')

// Funil real da KeroSolar em 15/11/2026 (ordem).
const nomes = [
  'Chegada', 'Chegada Insta/Face', 'Chegada pelo Site', 'Não respondeu o anúncio', 'Não respondeu Insta/Face',
  'Recebeu orçamento automático', 'Recebeu orçamento manual', 'Ficou de enviar a conta', 'Financiamento pedido de documentos',
  'Financiamento Aprovado. ', 'Vistoria agendada', 'Fechou', 'Em homologação', 'Finalizado', 'Já é cliente',
  'Repescagem', 'Repescagem Insta/Face', '15 dias depois', '30 dias depois', '180 dias depois', 'Leads adquiridos',
]
// Níveis definidos pelo dono (topo/meio/fim), gravados em Stage.funnelLevel.
const nivelDe = (i: number) => (i <= 4 ? 'top' : i <= 7 ? 'middle' : i <= 13 ? 'bottom' : null)
const funil = nomes.map((name, i) => ({ id: `s${i}`, name, sortOrder: i, isWon: false, isLost: false, funnelLevel: nivelDe(i) }))
const etapa = (nome: string) => funil.find((s) => s.name.trim() === nome)!

describe('etapaQualifica — lead que passa do financiamento (regra do dono 15/11/2026)', () => {
  it('etapas de avanço depois do financiamento qualificam', () => {
    for (const n of ['Financiamento Aprovado.', 'Vistoria agendada', 'Fechou', 'Em homologação', 'Finalizado']) {
      expect(etapaQualifica(etapa(n), funil)).toBe(true)
    }
  })
  it('a própria etapa do financiamento e as anteriores não qualificam', () => {
    for (const n of ['Chegada', 'Recebeu orçamento automático', 'Ficou de enviar a conta', 'Financiamento pedido de documentos']) {
      expect(etapaQualifica(etapa(n), funil)).toBe(false)
    }
  })
  it('repescagem, escada de dias, leads adquiridos e "já é cliente" nunca qualificam', () => {
    for (const n of ['Já é cliente', 'Repescagem', 'Repescagem Insta/Face', '15 dias depois', '180 dias depois', 'Leads adquiridos']) {
      expect(etapaQualifica(etapa(n), funil)).toBe(false)
    }
  })
  it('etapa de venda ganha sempre qualifica; perdida nunca', () => {
    expect(etapaQualifica({ id: 'w', name: 'Ganho', sortOrder: 2, isWon: true, isLost: false }, funil)).toBe(true)
    expect(etapaQualifica({ id: 'l', name: 'Perdido', sortOrder: 11, isWon: false, isLost: true }, funil)).toBe(false)
  })
  it('funil sem a etapa de financiamento → nada qualifica (só venda ganha)', () => {
    const semFin = funil.filter((s) => !/financiamento pedido/i.test(s.name))
    expect(etapaQualifica(etapa('Vistoria agendada'), semFin)).toBe(false)
  })
})

describe('publicarDesfechoAoEntrar — "Fechou" é venda ganha (regra do dono 15/11/2026)', () => {
  const fechou = () => { const s = funil.find((x) => x.name === 'Fechou')!; s.isWon = true; return s }
  beforeEach(() => { chamadas.length = 0; db.lead.customFields = {}; vi.clearAllMocks() })

  it('chegou em Fechou → lead.qualified e depois lead.won, com canal de origem e anúncio', async () => {
    await publicarDesfechoAoEntrar('L1', fechou().id)
    expect(chamadas).toEqual(['qualified', 'won'])
    expect(nervo.publishLeadWon).toHaveBeenCalledWith({ leadId: 'L1', contactPhone: '5521999990000', sourceChannel: 'instagram', sourceAdId: 'AD9', valueReais: 15000 })
  })

  it('saiu e voltou para Fechou → não manda de novo', async () => {
    await publicarDesfechoAoEntrar('L1', fechou().id)
    await publicarDesfechoAoEntrar('L1', funil.find((x) => x.name === 'Em homologação')!.id)
    await publicarDesfechoAoEntrar('L1', fechou().id)
    expect(chamadas).toEqual(['qualified', 'won'])
  })

  it('etapa comum antes do financiamento → nada sai', async () => {
    await publicarDesfechoAoEntrar('L1', funil.find((x) => x.name === 'Recebeu orçamento automático')!.id)
    expect(chamadas).toEqual([])
  })
})

describe('lead.stage.reached — nível do funil (combinado com o Marketing 15/11/2026)', () => {
  const id = (n: string) => funil.find((x) => x.name.trim() === n)!.id
  beforeEach(() => { chamadas.length = 0; db.lead.customFields = {}; vi.clearAllMocks(); process.env.NERVO_SEND_STAGE_LEVEL = '1'; funil.find((x) => x.name === 'Fechou')!.isWon = true })

  it('uma vez por nível, na ordem; repescagem não conta; Fechou: nível antes de qualified e won', async () => {
    for (const n of ['Chegada', 'Não respondeu o anúncio', 'Recebeu orçamento automático', 'Ficou de enviar a conta', 'Repescagem', 'Recebeu orçamento manual', 'Fechou']) {
      await publicarDesfechoAoEntrar('L1', id(n))
    }
    expect(chamadas).toEqual(['nivel:top', 'nivel:middle', 'nivel:bottom', 'qualified', 'won'])
    expect(nervo.publishLeadStageReached).toHaveBeenCalledWith({ leadId: 'L1', funnelLevel: 'bottom', stageName: 'Fechou', sourceChannel: 'instagram', sourceAdId: 'AD9' })
  })

  it('nível pulado não é enviado', async () => {
    await publicarDesfechoAoEntrar('L1', id('Recebeu orçamento automático'))
    expect(chamadas).toEqual(['nivel:middle'])
  })

  it('chave desligada → nada de nível', async () => {
    delete process.env.NERVO_SEND_STAGE_LEVEL
    await publicarDesfechoAoEntrar('L1', id('Chegada'))
    expect(chamadas).toEqual([])
  })
})
