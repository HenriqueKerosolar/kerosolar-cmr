import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// prisma simulado: só o que o comando lê; envio nunca pode acontecer nestes casos
const banco = vi.hoisted(() => ({ customFields: {} as Record<string, unknown>, enviado: false }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findUnique: vi.fn(async () => ({ customFields: banco.customFields })), update: vi.fn() },
    conversation: { findFirst: vi.fn(async () => { banco.enviado = true; return null }) },
    note: { create: vi.fn() },
  },
}))
vi.mock('../enviar-arquivo', () => ({ enviarArquivoNaConversa: vi.fn(async () => { banco.enviado = true; return { ok: true } }) }))

import { comandoEnviaOrcamento } from './orcamento-cmd'
import { lerComandoEnviaOrcamento, validarOrcamentoSalvo } from './orcamento'

const agora = new Date('2026-11-24T15:00:00Z')
const salvo = { arquivo: '/api/uploads/in_1_2.pdf', valorCliente: 12600.06, kwp: 4.34, criadoEm: '2026-11-24T12:00:00Z', numero: 'KS-20261124-9F2K' }

beforeEach(() => { banco.customFields = {}; banco.enviado = false })

describe('comando "envia orçamento"', () => {
  it('reconhece só a mensagem inteira', () => {
    for (const t of ['envia orçamento', 'Envia o orçamento', 'enviar orçamento', 'envia orcamento.', 'ENVIE O ORÇAMENTO!'])
      expect(lerComandoEnviaOrcamento(t), t).toBe(true)
    for (const t of ['já te envio o orçamento', 'envia orçamento pro João', 'orçamento', 'faz 800 kwh'])
      expect(lerComandoEnviaOrcamento(t), t).toBe(false)
  })
  it('validação: sem orçamento → erro; vencido (> 3 dias) → erro; recente → ok', () => {
    expect(validarOrcamentoSalvo(undefined, agora)).toHaveProperty('erro', expect.stringMatching(/não tem orçamento gerado/))
    expect(validarOrcamentoSalvo({ ...salvo, criadoEm: '2026-11-20T12:00:00Z' }, agora)).toHaveProperty('erro', expect.stringMatching(/gere de novo com "cota belenus"/))
    expect(validarOrcamentoSalvo(salvo, agora)).toEqual({ ok: salvo })
  })
  it('sem orçamento no lead → erro claro e NADA é enviado', async () => {
    await expect(comandoEnviaOrcamento('lead1', 'envia orçamento', 'u1', agora)).rejects.toThrow(/não tem orçamento gerado/)
    expect(banco.enviado).toBe(false)
  })
  it('orçamento vencido → erro claro e NADA é enviado', async () => {
    banco.customFields = { orcamentoBelenus: { ...salvo, criadoEm: '2026-11-20T12:00:00Z' } }
    await expect(comandoEnviaOrcamento('lead1', 'envia o orçamento', 'u1', agora)).rejects.toThrow(/vencido/)
    expect(banco.enviado).toBe(false)
  })
  it('outra frase não é tratada', async () => {
    expect(await comandoEnviaOrcamento('lead1', 'oi, tudo bem?', 'u1', agora)).toEqual({ tratado: false })
  })
})
