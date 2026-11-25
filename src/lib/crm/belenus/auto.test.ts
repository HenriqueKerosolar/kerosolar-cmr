import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// ── simulados: banco, cotação (Belenus), PDF, envio ─────────────────────────
const banco = vi.hoisted(() => ({
  config: null as null | { value: string },
  notas: [] as string[],
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn(async () => banco.config) },
    lead: { findUnique: vi.fn(async () => ({ contact: { name: 'Rafael Dias', phone: '5522999233907', whatsappId: null, email: null, customFields: null } })) },
    note: { create: vi.fn(async ({ data }: { data: { content: string } }) => { banco.notas.push(data.content); return {} }) },
    conversation: { findUnique: vi.fn(async () => ({ id: 'conv1', channel: 'whatsapp', accountId: null, externalId: '5522999233907', contact: { whatsappId: '5522999233907', phone: null } })) },
  },
}))
const cotacao = vi.hoisted(() => ({ montar: vi.fn() }))
vi.mock('./cotar', () => ({
  montarKitBelenus: cotacao.montar,
  entradaDoLead: (kwp: number) => ({ kwp }),
}))
vi.mock('./orcamento-cmd', () => ({
  gerarOrcamentoDoLead: vi.fn(async () => ({ arquivo: '/api/uploads/in_1_2.pdf', valorCliente: 12600.06, kwp: 4.34, criadoEm: '2026-11-24T15:00:00Z', numero: 'KS-20261124-9F2K' })),
}))
const envio = vi.hoisted(() => ({ enviar: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, messageId: 'm1' })), ler: vi.fn(() => Buffer.from('%PDF-1.3 teste')) }))
vi.mock('../enviar-arquivo', () => ({ enviarArquivoNaConversa: envio.enviar }))
vi.mock('../media', () => ({ lerMidiaSalva: envio.ler }))
const alcance = vi.hoisted(() => ({ aberto: true, ref: null as null | Record<string, unknown> }))
vi.mock('./api', () => ({ belenusAlcancavel: () => alcance.aberto }))
vi.mock('./banco', () => ({
  buscarReferencia: vi.fn(async () => alcance.ref),
  orcamentoDaReferencia: vi.fn((ref: { resultado: Record<string, unknown> }) => ({ ...ref.resultado, avisos: ['do banco'], valorCliente: 9999 })),
}))

import {
  belenusAutoLigado, documentoDoOrcamento, enviarDocumentoDepois, orcamentoBelenusAuto, podeUsarBelenusNoOrcamento,
  solarComValorBelenus,
} from './auto'
import { calcularSolarPorKwh, orcamentoTexto } from '../solar-calc'
import type { ResultadoCotacao } from './regras'

const p = (descricao: string, qtde: number) => ({ codigo: 'X', descricao, qtde, preco: null })
function resultado(valorCliente: number | null, transformador?: number): ResultadoCotacao {
  return {
    potenciaPedidaKwp: 4.34,
    modulo: { ...p('MÓDULO 620W', 7), potenciaW: 620, potenciaKitKwp: 4.34 },
    inversor: { ...p('INVERSOR 3KW', 1), potenciaKw: 3, ligacao: 'Monofásico', tensao: '220V' },
    estrutura: [], componentesCC: [], componentesCA: [], strings: 1, avisos: [], ajustes: [], totalProdutos: 6822.41,
    confirmacao: valorCliente ? { numeroCotacao: null, totalProdutos: 6822.41, frete: 600, freteDescricao: 'Belenus Entrega no Cliente', seguro: 77.63, impostos: [], valorTotalNF: null, total: 7500.04, pagamento: null } : null,
    cotacaoSalva: valorCliente ? { numeroWeb: 'WEB-007271619', validaAte: '27/11' } : undefined,
    transformador, valorCliente,
  }
}

const NORMAL = { permitido: true, simulador: false, hibrido: false, ampliacao: false, valorVendaFixo: false, kitMinimo: false, variosValores: false, soTransformador: false }

beforeEach(() => {
  process.env.BELENUS_EMAIL = 'robo-teste@exemplo.invalid'
  process.env.BELENUS_SENHA = 'senha-falsa-de-teste'
  banco.config = null
  banco.notas = []
  cotacao.montar.mockReset()
  envio.enviar.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.BELENUS_EMAIL
  delete process.env.BELENUS_SENHA
})

describe('quando o orçamento automático usa a Belenus', () => {
  it('caso normal → usa', () => {
    expect(podeUsarBelenusNoOrcamento(NORMAL)).toBe(true)
  })
  it('híbrido, ampliação, valor de venda manual, kit mínimo, vários valores, só transformador, simulador ou canal síncrono → NÃO usa', () => {
    for (const k of ['hibrido', 'ampliacao', 'valorVendaFixo', 'kitMinimo', 'variosValores', 'soTransformador', 'simulador'] as const)
      expect(podeUsarBelenusNoOrcamento({ ...NORMAL, [k]: true }), k).toBe(false)
    expect(podeUsarBelenusNoOrcamento({ ...NORMAL, permitido: false }), 'webchat/webhook antigo').toBe(false)
  })
  it('chave belenus_auto: padrão LIGADO; "0" desliga; sem credenciais → desligado', async () => {
    expect(await belenusAutoLigado()).toEqual({ ligado: true })
    banco.config = { value: '0' }
    expect((await belenusAutoLigado()).ligado).toBe(false)
    banco.config = { value: '1' }
    expect((await belenusAutoLigado()).ligado).toBe(true)
    delete process.env.BELENUS_SENHA
    expect(await belenusAutoLigado()).toMatchObject({ ligado: false, motivo: expect.stringMatching(/BELENUS_EMAIL/) })
  })
})

describe('orcamentoBelenusAuto', () => {
  it('sucesso → valor ao cliente da Belenus, PDF gerado e nota com kit/total/WEB/link', async () => {
    cotacao.montar.mockResolvedValue(resultado(12600.06, 600))
    const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: { medidor: 'monofásico' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valorCliente).toBe(12600.06)
    expect(r.orcamento?.numero).toBe('KS-20261124-9F2K')
    expect(r.nota).toMatch(/WEB-007271619/)
    expect(r.nota).toMatch(/\/api\/uploads\/in_1_2\.pdf/)
    expect(r.nota).toMatch(/Enviado ao cliente pelo orçamento automático/)
    // kWp pela fórmula: 420 ÷ (4,5 × 30 × 0,8) = 3,89 kWp
    expect(cotacao.montar.mock.calls[0][0].kwp).toBeCloseTo(420 / 108, 1)
  })
  it('texto do orçamento sai com o VALOR da Belenus (parcelas/payback recalculados)', () => {
    const formula = calcularSolarPorKwh(420)
    const s = solarComValorBelenus(formula, 12600.06, true)
    expect(s.valorSistema).toBe(12600.06)
    expect(s.transformador).toBe(true)
    expect(orcamentoTexto(s)).toMatch(/12\.600/)
    expect(s.financiamento[0].parcela).not.toBe(formula.financiamento[0].parcela)
    expect(solarComValorBelenus(formula, 12000, false).transformador).toBeUndefined()
  })
  it('falha da Belenus → ok:false com o motivo (o motor manda a fórmula)', async () => {
    cotacao.montar.mockRejectedValue(new Error('A Belenus respondeu com erro (HTTP 500, etapa: módulos).'))
    const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {} })
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/HTTP 500/) })
  })
  it('demora (passou do limite) → ok:false (fórmula), sem esperar a Belenus terminar', async () => {
    cotacao.montar.mockReturnValue(new Promise(() => {}))
    const t0 = Date.now()
    const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {}, limiteMs: 30 })
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/passou de/) })
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('nenhum CRM aberto → não chama a Belenus e usa o BANCO de referência (mesmo valor)', async () => {
    cotacao.montar.mockClear()
    alcance.aberto = false
    alcance.ref = { placas: 7, resultado: resultado(11929.82) }
    try {
      const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {} })
      expect(cotacao.montar).not.toHaveBeenCalled()
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.valorCliente).toBe(9999)
    } finally { alcance.aberto = true; alcance.ref = null }
  })
  it('CRM aberto → SEMPRE cota na Belenus, mesmo tendo a mesma potência no banco', async () => {
    cotacao.montar.mockClear()
    cotacao.montar.mockResolvedValue(resultado(12600.06))
    alcance.ref = { placas: 7, criadoEm: new Date().toISOString(), resultado: resultado(11929.82) }
    try {
      const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {} })
      expect(cotacao.montar).toHaveBeenCalledTimes(1)
      expect(r.ok && r.valorCliente).toBe(12600.06)
    } finally { alcance.ref = null }
  })
  it('nenhum CRM aberto e banco vazio → ok:false (fórmula)', async () => {
    alcance.aberto = false
    try {
      const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {} })
      expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/nenhum CRM aberto.*sem orçamento de referência/) })
    } finally { alcance.aberto = true }
  })
  it('sem total na Confirmação → ok:false', async () => {
    cotacao.montar.mockResolvedValue(resultado(null))
    const r = await orcamentoBelenusAuto({ leadId: 'lead1', consumoKwh: 420, cf: {} })
    expect(r.ok).toBe(false)
  })
})

describe('PDF depois do texto', () => {
  it('envia o PDF como documento pelo canal da conversa', async () => {
    const d = documentoDoOrcamento('lead1', 'conv1', { arquivo: '/api/uploads/in_1_2.pdf', valorCliente: 12600.06, kwp: 4.34, criadoEm: 'x', numero: 'KS-20261124-9F2K' })
    await enviarDocumentoDepois(d)
    expect(envio.enviar).toHaveBeenCalledTimes(1)
    expect(envio.enviar.mock.calls[0][0]).toMatchObject({ leadId: 'lead1', nome: 'Orcamento-KeroSolar-KS-20261124-9F2K.pdf', mime: 'application/pdf', copiaLocal: '/api/uploads/in_1_2.pdf' })
  })
  it('falha no envio do PDF → nota para o operador (o texto já saiu)', async () => {
    envio.enviar.mockResolvedValueOnce({ ok: false, erro: 'WhatsApp Cloud não configurado.', status: 503 } as never)
    await enviarDocumentoDepois(documentoDoOrcamento('lead1', 'conv1', { arquivo: '/api/uploads/a.pdf', valorCliente: 1, kwp: 1, criadoEm: 'x', numero: 'KS-1' }))
    expect(banco.notas.join('\n')).toMatch(/PDF do orçamento não foi enviado/)
  })
})
