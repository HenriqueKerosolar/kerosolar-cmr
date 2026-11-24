import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { limparNomeProduto, montarDadosOrcamento, numeroOrcamentoKS, orcamentoVencido } from './orcamento'
import { gerarPdfOrcamento } from './orcamento-pdf'
import type { Peca, ResultadoCotacao } from './regras'

const p = (descricao: string, qtde: number, extra: Partial<Peca> = {}): Peca => ({ codigo: `COD-${descricao.slice(0, 6)}`, descricao, qtde, preco: null, ...extra })

/** Kit parecido com a cotação real de 4,34 kWp (Rafael Dias). */
function kitExemplo(monofasico: boolean): ResultadoCotacao {
  return {
    potenciaPedidaKwp: 4.34,
    modulo: { ...p('MÓDULO BIFACIAL 132 CÉL. N-TYPE 620W BLACK FRAME', 7, { fabricante: 'OSDA' }), codigo: 'B-123456', potenciaW: 620, potenciaKitKwp: 4.34 },
    inversor: { ...p('INVERSOR ON-GRID MONOFÁSICO 1 MPPT 220V 3KW BELENERGY', 1, { fabricante: 'AUXSOL' }), potenciaKw: 3, ligacao: 'Monofásico', tensao: '220V' },
    estrutura: [
      p('GARRA DE ATERRAMENTO 2 PEÇAS EM ALUMÍNIO', 1, { unidade: 'JG' }),
      p('SUPORTE GANCHO TELHA COLONIAL C/ PROLONGADOR 2 PEÇAS EM ALUMÍNIO', 5),
      p('GRAMPO FINAL 30MM 4 PEÇAS EM ALUMÍNIO', 1, { unidade: 'JG' }),
      p('GRAMPO INTERMEDIÁRIO 2 PEÇAS EM ALUMÍNIO', 6, { unidade: 'JG' }),
      p('JUNÇÃO PARA PERFIL 1 PEÇA EM ALUMÍNIO', 6),
      p('PERFIL DE FIXAÇÃO DO MÓDULO 31,9MM X 53,8MM X 1,23M EM ALUMÍNIO', 2),
      p('PERFIL DE FIXAÇÃO DO MÓDULO 31,9MM X 53,8MM X 2,36M EM ALUMÍNIO', 6),
    ],
    componentesCC: [
      p('CABO SOLAR 6MM 0,6/1KV AC 1,8KV DC PRETO', 25),
      p('CABO SOLAR 6MM 0,6/1KV AC 1,8KV DC VERMELHO', 25),
      p('CONECTOR SOLAR FOTOVOLTAICO MACHO E FÊMEA C/ 2 PARES', 2, { unidade: 'PT' }),
      p('CABO SOLAR 6MM 0,6/1KV AC 1,8KV DC VERDE (ATERRAMENTO)', 25),
    ],
    componentesCA: [p('DPS VCL SLIM CLASSE I/II CA 275V 12,5/60KA', 2, { fabricante: 'CLAMPER' })],
    strings: 1, avisos: [], ajustes: [], totalProdutos: 6822.41,
    confirmacao: { numeroCotacao: 'WEB-007268278', totalProdutos: 6822.41, frete: 600, freteDescricao: 'Belenus Entrega no Cliente', seguro: 77.63, impostos: [], valorTotalNF: null, total: 7500.04, pagamento: null },
    transformador: monofasico ? 600 : undefined,
    valorCliente: monofasico ? 12600.06 : 12000.06,
    layoutEstrutura: { telhado: 'colonial', grupo: 'Telhado Cerâmico', subGrupo: 'Colonial', linhas: 1, modulosPorLinha: 8, orientacao: 'Retrato' },
  }
}

const agora = new Date('2026-11-24T15:00:00Z')
const lead = { id: 'cmabc123xyz9f2k', nome: 'Rafael Dias', telefone: '5522999233907', cidadeUf: 'Casimiro de Abreu - RJ', consumoKwh: 300, email: 'rafael@exemplo.com', endereco: 'Rua das Flores, 37 - Centro', cep: '28860-000' }

describe('número do orçamento KS', () => {
  it('KS-AAAAMMDD-<4 últimos do id do lead>, no fuso de Brasília', () => {
    expect(numeroOrcamentoKS(agora, 'cmabc123xyz9f2k')).toBe('KS-20261124-9F2K')
    // 01h UTC do dia 25 ainda é dia 24 em Brasília
    expect(numeroOrcamentoKS(new Date('2026-11-25T01:00:00Z'), 'ab')).toBe('KS-20261124-00AB')
  })
  it('validade de 3 dias', () => {
    expect(orcamentoVencido('2026-11-22T15:00:00Z', agora)).toBe(false)
    expect(orcamentoVencido('2026-11-21T14:00:00Z', agora)).toBe(true)
    expect(orcamentoVencido('lixo', agora)).toBe(true)
  })
})

describe('dados do PDF a partir do kit', () => {
  it('sem código, sem BELENERGY/BELENUS, fabricante só em módulo/inversor/DPS, com transformador e PIX', () => {
    const d = montarDadosOrcamento(kitExemplo(true), lead, agora)
    expect(d.numero).toBe('KS-20261124-9F2K')
    expect(d.numero).not.toMatch(/WEB/)
    expect(d.emissao).toBe('24/11/2026')
    expect(d.validaAte).toBe('27/11/2026')
    expect(d.kwp).toBe(4.34)
    expect(d.geracaoMes).toBe(420)
    expect(d.geracaoAno).toBe(5040)
    const tudo = JSON.stringify(d)
    expect(tudo).not.toMatch(/BELENERGY|BELENUS|COD-|B-123456/i)
    expect(d.produtos[0]).toEqual({ nome: 'MÓDULO BIFACIAL 132 CÉL. N-TYPE 620W BLACK FRAME', fabricante: 'Osda', qtde: '7 PC' })
    expect(d.produtos[1]).toEqual({ nome: 'INVERSOR ON-GRID MONOFÁSICO 1 MPPT 220V 3KW', fabricante: 'Auxsol', qtde: '1 PC' })
    expect(d.produtos.find((x) => x.nome.startsWith('DPS'))?.fabricante).toBe('Clamper')
    expect(d.produtos.filter((x) => x.fabricante)).toHaveLength(3)
    expect(d.produtos.find((x) => x.nome.includes('PRETO'))?.qtde).toBe('25 M')
    expect(d.produtos.at(-1)).toEqual({ nome: 'TRANSFORMADOR', qtde: '1 PC' })
    expect(d.valorTotal).toBe(12600.06)
    expect(d.valorPix).toBe(11970.06)
    expect(d.observacoes.at(-1)).toBe('Medidor monofásico: inclui transformador.')
    expect(d.cartao[0]).toMatchObject({ n: 2, semJuros: true })
    expect(d.cartao.at(-1)?.n).toBe(24)
    expect(d.financiamento.length).toBeGreaterThan(0)
    expect(d.economia?.contaHoje).toBeGreaterThan(0)
    expect(d.estrutura).toMatchObject({ tipo: 'Colonial', linhas: 1, modulosPorLinha: 8, orientacao: 'Retrato' })
  })
  it('dados do cliente: e-mail, endereço e CEP quando existem (sem CPF/CNPJ)', () => {
    const d = montarDadosOrcamento(kitExemplo(true), lead, agora)
    expect(d.cliente).toEqual({ nome: 'Rafael Dias', cidadeUf: 'Casimiro de Abreu - RJ', telefone: '(22) 99923-3907', email: 'rafael@exemplo.com', endereco: 'Rua das Flores, 37 - Centro', cep: '28860-000' })
    const sem = montarDadosOrcamento(kitExemplo(true), { id: 'x1', nome: 'Ana', telefone: '21999998888' }, agora)
    expect(sem.cliente).toEqual({ nome: 'Ana', cidadeUf: 'Rio de Janeiro - RJ', telefone: '(21) 99999-8888' })
  })
  it('sem transformador, sem consumo (sem economia) e cidade padrão', () => {
    const d = montarDadosOrcamento(kitExemplo(false), { id: 'x1', nome: null, telefone: null }, agora)
    expect(d.produtos.some((x) => x.nome === 'TRANSFORMADOR')).toBe(false)
    expect(d.economia).toBeNull()
    expect(d.cliente.cidadeUf).toBe('Rio de Janeiro - RJ')
    expect(d.observacoes).toHaveLength(4)
  })
  it('sem valor ao cliente → erro', () => {
    expect(() => montarDadosOrcamento({ ...kitExemplo(false), valorCliente: null }, lead, agora)).toThrow(/Sem o valor/)
  })
  it('limpa o nome do produto', () => {
    expect(limparNomeProduto('INVERSOR 3KW - BELENERGY')).toBe('INVERSOR 3KW')
    expect(limparNomeProduto('BELENUS KIT ESTRUTURA')).toBe('KIT ESTRUTURA')
  })
})

describe('PDF', () => {
  it('gera um PDF válido (começa com %PDF) e grava um exemplo para conferência', async () => {
    const d = montarDadosOrcamento(kitExemplo(true), lead, agora)
    const pdf = await gerarPdfOrcamento(d)
    expect(pdf.length).toBeGreaterThan(5000)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    const saida = path.join(os.tmpdir(), 'kerosolar-orcamento-exemplo.pdf')
    fs.writeFileSync(saida, pdf)
  })
})
