import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { chamarBelenus } from './api'
import { montarKitBelenus } from './cotar'
import { ROTA_PROIBIDA, rotaPermitida, textoNota } from './regras'

// Valores FALSOS só para o teste (nunca credencial real).
const EMAIL_TESTE = 'robo-teste@exemplo.invalid'
const SENHA_TESTE = 'senha-falsa-de-teste'
const TOKEN_TESTE = 'token-falso-de-teste-123456'

type Cenario = { inversoresMono: unknown[]; inversoresTri?: unknown[] }

/** Servidor falso da Belenus: responde como o site espera (envelope { isSucceed, data }). */
function belenusFalsa(c: Cenario) {
  const urls: string[] = []
  const ok = (data: unknown) => new Response(JSON.stringify({ isSucceed: true, data, messages: [] }), { status: 200 })
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    const corpo = init?.body ? JSON.parse(String(init.body)) : {}
    const rota = url.replace('https://belenus.com.br/', '')
    if (rota.endsWith('PessoaJuridicaByEmail')) {
      expect(corpo).toEqual({ email: EMAIL_TESTE, senha: SENHA_TESTE })
      return new Response(JSON.stringify({ token: TOKEN_TESTE, userType: 1 }), { status: 200 })
    }
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_TESTE}`)
    const fim = rota.replace('api/catalogo/KitPersonalizado/', '')
    switch (fim) {
      case 'Modulos':
        expect(corpo).toEqual({ site: '0001', potenciaProjeto: 4.34, modulo: '', qtde: 0, fabricantes: [{ fabricante: '' }] })
        return ok({ modulos: [
          { item: 'M555', descricaoItem: 'PAINEL 555W', potencia: 555, numeroModulos: 8, potenciaMaxima: 4.44, index: 1 },
          { item: 'M620', descricaoItem: 'PAINEL OSDA 620W', potencia: 620, numeroModulos: 7, potenciaMaxima: 4.34, index: 2 },
          { item: 'M610', descricaoItem: 'PAINEL 610W', potencia: 610, numeroModulos: 8, potenciaMaxima: 4.88, index: 3 },
        ] })
      case 'InversorFiltro':
        if (!corpo.tipoInversor) return ok({ listTipoInversor: [{ tipoInversor: 'Híbrido' }, { tipoInversor: 'On Grid' }] })
        if (!corpo.tipoLigacao) return ok({ listTipoLigacao: [{ tipoLigacao: 'Monofásico' }, { tipoLigacao: 'Trifásico' }] })
        if (!corpo.tensaoNominal) return ok({ listTensaoNominal: [{ tensaoNominal: '220V' }, { tensaoNominal: '380V' }] })
        return ok({ listFabricante: [{ fabricante: 'GROWATT' }, { fabricante: 'AUXSOL' }] })
      case 'Inversor':
        expect(corpo.modulo).toBe('M620')
        expect(corpo.qtdeModulo).toBe(7)
        return ok({ parametros: { overload: 1.3 }, inversores: /trif/i.test(corpo.tipoLigacao) ? (c.inversoresTri ?? []) : c.inversoresMono })
      case 'ConferirPotenciaInversor':
        expect(corpo.listInversores[0].inversorQtde).toBe(1)
        return ok(true)
      case 'TipoEstrutura':
        return ok({ listTipos: [
          { grupo: 'Telhado Metálico', ordem: 2, orientacao: [{ descricao: 'Retrato' }], subGrupo: [{ tipo: 'MET1', subGrupo: 'Trapezoidal', ordem: 1 }] },
          { grupo: 'Telhado Colonial', ordem: 1, orientacao: [{ descricao: 'Paisagem' }, { descricao: 'Retrato' }], subGrupo: [{ tipo: 'COL1', subGrupo: 'Colonial gancho', ordem: 1 }] },
        ] })
      case 'Estrutura':
        // regra do dono: estrutura de 4 em 4 painéis (7 → 8)
        expect(corpo.layout[0]).toMatchObject({ arranjo: 1, linhas: 1, moduloLinha: 8, orientacao: 'Retrato', tipoEstrutura: 'COL1' })
        expect(corpo.moduloQtde).toBe(8)
        return ok({ structure: [
          { item: 'E1', descricaoItem: 'TRILHO 2,4M', qtde: 6 }, { item: 'E1', descricaoItem: 'TRILHO 2,4M', qtde: 6 },
          { item: 'E2', descricaoItem: 'GANCHO COLONIAL', qtde: 10 },
        ] })
      case 'Outros':
        expect(corpo.ListStructure).toHaveLength(2)
        return ok({ outros: corpo.sugestao === 1
          ? [{ item: 'C4P', descricaoItem: 'CABO SOLAR 4MM PRETO', qtde: 50 }, { item: 'C4V', descricaoItem: 'CABO SOLAR 4MM VERMELHO', qtde: 50 }, { item: 'MC4', descricaoItem: 'CONECTOR MC4', qtde: 2 }]
          : [{ item: 'C6P', descricaoItem: 'CABO SOLAR 6MM PRETO', qtde: 0 }, { item: 'C6V', descricaoItem: 'CABO SOLAR 6MM VERMELHO', qtde: 0 }, { item: 'CVD', descricaoItem: 'CABO VERDE 6MM', qtde: 0 }] })
      case 'OutrosAC':
        return ok({ outrosAC: [{ item: 'DPS1', descricaoItem: 'DPS 275V 20KA', qtde: 1 }, { item: 'DJ', descricaoItem: 'DISJUNTOR 25A', qtde: 1 }] })
    }
    throw new Error(`rota inesperada no teste: ${rota}`)
  })
  return { fn, urls }
}

const auxsol3k = { item: 'INV3K', descricaoItem: 'INVERSOR AUXSOL 3KW MONO 220V', fabricante: 'AUXSOL', potenciaNominalSaida: 3000, numInversores: 1, index: 2, tipoLigacao: 'Monofásico', tensaoSaida: '220V' }

let logs: string[] = []
beforeEach(() => {
  process.env.BELENUS_EMAIL = EMAIL_TESTE
  process.env.BELENUS_SENHA = SENHA_TESTE
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.BELENUS_EMAIL
  delete process.env.BELENUS_SENHA
})

describe('montarKitBelenus (fetch simulado)', () => {
  it('monta o kit on-grid seguindo as regras do dono e só usa rotas de consulta', async () => {
    const b = belenusFalsa({ inversoresMono: [{ item: 'G3K', fabricante: 'GROWATT', potenciaNominalSaida: 3000, numInversores: 1, index: 1 }, auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'monofásico', tensao: 220, telhado: 'colonial' })

    expect(r.modulo).toMatchObject({ codigo: 'M620', qtde: 7, potenciaW: 620, potenciaKitKwp: 4.34 })
    expect(r.inversor).toMatchObject({ codigo: 'INV3K', qtde: 1, potenciaKw: 3 })
    expect(r.estrutura.map((e) => [e.codigo, e.qtde])).toEqual([['E1', 6], ['E2', 10]])
    expect(r.strings).toBe(1)
    const cc = Object.fromEntries(r.componentesCC.map((p) => [p.codigo, p.qtde]))
    expect(cc).toEqual({ MC4: 2, C6P: 25, C6V: 25, CVD: 25 })
    const ca = Object.fromEntries(r.componentesCA.map((p) => [p.codigo, p.qtde]))
    expect(ca).toEqual({ DPS1: 2, DJ: 1 })
    expect(r.totalProdutos).toBeNull()
    expect(textoNota(r)).toMatch(/só calcula o total ao criar o carrinho/)

    // 🔒 nenhuma rota proibida, todas na lista de consulta
    expect(b.urls.length).toBeGreaterThan(5)
    for (const u of b.urls) {
      expect(rotaPermitida(u), u).toBe(true)
      expect(ROTA_PROIBIDA.test(u), u).toBe(false)
    }
    // 🔒 o log não tem token, senha nem e-mail
    const tudo = logs.join('\n')
    expect(tudo).toContain('[belenus]')
    for (const segredo of [TOKEN_TESTE, SENHA_TESTE, EMAIL_TESTE]) expect(tudo).not.toContain(segredo)
  })

  it('mais de 1 inversor sugerido → 1 inversor trifásico', async () => {
    const tri = { item: 'INV8T', descricaoItem: 'INVERSOR AUXSOL 8KW TRI', fabricante: 'AUXSOL', potenciaNominalSaida: 8000, numInversores: 1, index: 1, tipoLigacao: 'Trifásico' }
    const b = belenusFalsa({ inversoresMono: [{ ...auxsol3k, numInversores: 2 }], inversoresTri: [tri] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial' })
    expect(r.inversor.codigo).toBe('INV8T')
    expect(r.avisos.join(' ')).toMatch(/mais de 1 inversor/)
    // trifásico → 3 DPS
    expect(r.componentesCA.find((p) => p.codigo === 'DPS1')?.qtde).toBe(3)
  })

  it('medidor monofásico e inversor acima de 5 kW → avisa o transformador (R$ 600)', async () => {
    const tri = { item: 'INV6T', descricaoItem: 'INVERSOR 6KW TRI', fabricante: 'AUXSOL', potenciaNominalSaida: 6000, numInversores: 1, index: 1 }
    const b = belenusFalsa({ inversoresMono: [{ ...auxsol3k, item: 'INV6M', potenciaNominalSaida: 6000 }], inversoresTri: [tri] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'monofásico', tensao: 220, telhado: 'colonial' })
    expect(r.inversor.codigo).toBe('INV6T')
    expect(r.avisos.join(' ')).toMatch(/TRANSFORMADOR \(\+R\$ 600\)/)
  })

  it('sem medidor/telhado no lead → supõe monofásico 220 V e colonial e AVISA', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34 })
    expect(r.avisos.join(' ')).toMatch(/MONOFÁSICO 220 V/)
    expect(r.avisos.join(' ')).toMatch(/COLONIAL/)
  })

  it('sem credenciais → erro claro e nenhuma chamada à Belenus', async () => {
    delete process.env.BELENUS_EMAIL
    delete process.env.BELENUS_SENHA
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(montarKitBelenus({ kwp: 4.34 })).rejects.toThrow('Cadastre BELENUS_EMAIL e BELENUS_SENHA no Railway')
    expect(f).not.toHaveBeenCalled()
  })

  it('no máximo 1 cotação por vez', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const p1 = montarKitBelenus({ kwp: 4.34 })
    await expect(montarKitBelenus({ kwp: 4.34 })).rejects.toThrow(/em andamento/)
    await p1
  })
})

describe('chamarBelenus: rota proibida nunca sai', () => {
  it('bloqueia carrinho/pedido/pagamento antes do fetch', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const r of ['api/carrinho/KitPersonalizado/ConfirmarCarrinho', 'api/carrinho/KitPersonalizado/Confirmar', 'api/carrinho/KitPersonalizado/SalvarOrcamentoCliente', 'api/pedido/x', 'api/pagamento/x', 'api/carrinho/KitPersonalizado/IncluirSeguro'])
      await expect(chamarBelenus(r, {}, { token: 't', etapa: 'teste' })).rejects.toThrow(/bloqueada/)
    expect(f).not.toHaveBeenCalled()
  })
})
