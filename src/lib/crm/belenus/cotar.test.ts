import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { DEPS_BELENUS, TEMPO_LIMITE_MS, chamarBelenus } from './api'
import { montarKitBelenus } from './cotar'
import { ROTA_PROIBIDA, rotaPermitida, textoNota } from './regras'

// Valores FALSOS só para o teste (nunca credencial real).
const EMAIL_TESTE = 'robo-teste@exemplo.invalid'
const SENHA_TESTE = 'senha-falsa-de-teste'
const TOKEN_TESTE = 'token-falso-de-teste-123456'

type Cenario = { inversoresMono: unknown[]; inversoresTri?: unknown[]; confirmarSemTotal?: boolean; semFrete?: boolean; salvarFalha?: boolean }

/** Servidor falso da Belenus: responde como o site espera (envelope { isSucceed, data }). */
function belenusFalsa(c: Cenario) {
  const urls: string[] = []
  const confirmarCorpos: Record<string, unknown>[] = []
  const fretesCorpos: Record<string, unknown>[] = []
  const salvarCorpos: Record<string, unknown>[] = []
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
    // etapa 6 (Fase 2): Confirmação + leituras de frete e seguro
    if (rota === 'api/carrinho/KitPersonalizado/Confirmar') {
      expect((init?.headers as Record<string, string>)['X-CarrinhoId']).toBe('')
      confirmarCorpos.push(corpo)
      return ok(c.confirmarSemTotal ? { pedidoWeb: 7268278 } : {
        pedidoWeb: 7268278, carrinhoId: 'carrinho-teste', totalProdutos: 11445.78, valorTotalNF: 11445.78, peso: 250,
        metodoPagamentoID: 'BOLETO', clienteCnpjCpf: '00000000000000', nomeCliente: 'Cliente Teste',
        frete: { tipoFreteId: null, freteIncluso: 0 },
        itens: [{ sku: 'KIT', quantidade: 1, precos: { siteFaturamento: '0001', skuProduto: 'KIT-SKU' }, componentes: [{ sku: 'M620', quantidade: 7 }] }],
      })
    }
    if (rota.startsWith('api/fretes/TipoFrete/BuscarFretes')) {
      expect(rota).toContain('calcularValores=true')
      fretesCorpos.push(corpo)
      return new Response(JSON.stringify({ opcoes: c.semFrete ? [] : [
        { tipoFreteId: '01', descricao: 'Cliente Retira', freteIncluso: 0 },
        { tipoFreteId: '06', descricaoAmigavel: 'Belenus Entrega no Cliente', freteIncluso: 600 },
      ] }), { status: 200 })
    }
    if (rota === 'api/carrinho/KitPersonalizado/ValorSeguro') return ok(92.09)
    // Fase 4: salvar a cotação em "Meus orçamentos" (botão "Salvar" da Confirmação)
    if (rota === 'api/carrinho/KitPersonalizado/SalvarOrcamentoCliente') {
      salvarCorpos.push(corpo)
      if (c.salvarFalha) return new Response(JSON.stringify({ isSucceed: false, messages: [{ description: 'Erro ao salvar' }] }), { status: 400 })
      return ok({ ...corpo.carrinhoJson, pedidoWeb: 7300123 })
    }
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
  return { fn, urls, confirmarCorpos, fretesCorpos, salvarCorpos }
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
    // etapa 6: Confirmar chamado UMA vez, com o kit ajustado pela regra do dono
    expect(b.urls.filter((u) => u.endsWith('KitPersonalizado/Confirmar'))).toHaveLength(1)
    const corpoConf = b.confirmarCorpos[0] as { itens: { item: string; qtde: number; tipoKitmontado: string }[]; origemCarrinho: number; site: string }
    const itens = Object.fromEntries(corpoConf.itens.map((i) => [i.item, [i.tipoKitmontado, i.qtde]]))
    expect(itens).toMatchObject({ M620: ['modulo', 7], INV3K: ['inversor', 1], E1: ['estrutura', 6], C6P: ['outro', 25], CVD: ['outro', 25], DPS1: ['outroCA', 2] })
    expect(itens.C4P).toBeUndefined()
    expect(corpoConf).toMatchObject({ origemCarrinho: 4, site: '0001' })
    // frete para o município padrão (Rio de Janeiro - RJ) e total lido
    expect(b.fretesCorpos[0]).toMatchObject({ Cidade: 'Rio de Janeiro', Estado: 'RJ', Divisao: 'SOL', ValorPedido: 11445.78 })
    expect(r.confirmacao).toMatchObject({ numeroCotacao: 'WEB-007268278', totalProdutos: 11445.78, frete: 600, seguro: 92.09, total: 12137.87 })
    expect(r.transformador).toBe(600)
    expect(r.valorCliente).toBe(Math.round((12137.87 * 1.6 + 600) * 100) / 100)
    const nota = textoNota(r)
    expect(nota).toMatch(/WEB-007268278/)
    expect(nota).toMatch(/TOTAL BELENUS: R\$\s?12\.137,87/)
    expect(nota).toMatch(/VALOR AO CLIENTE: R\$\s?20\.020,59/)
    expect(nota).toMatch(/TRANSFORMADOR/)

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

  it('medidor monofásico 127 V e inversor acima de 5 kW → avisa o transformador (R$ 600)', async () => {
    // regra do dono: o limite de 5 kW é do monofásico 127 V ("110 V"); em 220 V vai até 10 kW
    const tri = { item: 'INV6T', descricaoItem: 'INVERSOR 6KW TRI', fabricante: 'AUXSOL', potenciaNominalSaida: 6000, numInversores: 1, index: 1 }
    const b = belenusFalsa({ inversoresMono: [{ ...auxsol3k, item: 'INV6M', potenciaNominalSaida: 6000 }], inversoresTri: [tri] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'monofásico', tensao: 127, telhado: 'colonial' })
    expect(r.inversor.codigo).toBe('INV6T')
    expect(r.avisos.join(' ')).toMatch(/TRANSFORMADOR \(\+R\$ 600\)/)
  })

  it('sem medidor/telhado no lead → supõe BIFÁSICO 220 V (sem transformador) e colonial e AVISA', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34 })
    expect(r.avisos.join(' ')).toMatch(/BIFÁSICO 220 V/)
    expect(r.transformador).toBeUndefined()
    expect(r.avisos.join(' ')).not.toMatch(/TRANSFORMADOR/)
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

  it('FILA: duas cotações pedidas juntas NÃO rodam ao mesmo tempo (a 2ª espera a 1ª terminar)', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const p1 = montarKitBelenus({ kwp: 4.34 })
    const p2 = montarKitBelenus({ kwp: 4.34 })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.modulo.codigo).toBe('M620')
    expect(r2.modulo.codigo).toBe('M620')
    // cada cotação começa com o login; o 2º login só acontece depois da última chamada da 1ª (o salvar)
    const logins = b.urls.map((u, i) => (u.endsWith('PessoaJuridicaByEmail') ? i : -1)).filter((i) => i >= 0)
    const salvamentos = b.urls.map((u, i) => (u.endsWith('SalvarOrcamentoCliente') ? i : -1)).filter((i) => i >= 0)
    expect(logins).toHaveLength(2)
    expect(logins[1]).toBeGreaterThan(salvamentos[0])
  })

  it('FILA: quem passa do tempo de espera desiste (o motor manda pela fórmula) e não trava os próximos', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    // Belenus "lenta" (5 ms por chamada) para a 1ª cotação ainda estar rodando quando a 2ª desiste
    vi.stubGlobal('fetch', async (...a: Parameters<typeof b.fn>) => { await new Promise((r) => setTimeout(r, 5)); return b.fn(...a) })
    const p1 = montarKitBelenus({ kwp: 4.34 })
    await expect(montarKitBelenus({ kwp: 4.34 }, { esperaMaxMs: 1 })).rejects.toThrow(/fila de cotações/)
    await p1
    // depois da 1ª, a fila anda normalmente
    await expect(montarKitBelenus({ kwp: 4.34 })).resolves.toMatchObject({ modulo: { codigo: 'M620' } })
  })
})

describe('etapa 6 (Confirmação): total ausente e frete', () => {
  it('total ausente → aviso claro, kit devolvido, Confirmar só 1 vez', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k], confirmarSemTotal: true })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial' })
    expect(r.modulo.codigo).toBe('M620')
    expect(r.confirmacao).toBeNull()
    expect(r.valorCliente).toBeNull()
    expect(r.avisos.join(' ')).toMatch(/não devolveu o total dos produtos/)
    expect(textoNota(r)).toMatch(/não consegui ler o total/)
    expect(b.urls.filter((u) => u.endsWith('KitPersonalizado/Confirmar'))).toHaveLength(1)
    for (const u of b.urls) expect(rotaPermitida(u), u).toBe(true)
  })

  it('sem opção "Belenus Entrega no Cliente" → total sem frete e aviso; município do lead é usado', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k], semFrete: true })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial', destino: { cidade: 'Niterói', uf: 'RJ' } })
    expect(b.fretesCorpos[0]).toMatchObject({ Cidade: 'Niterói', Estado: 'RJ' })
    expect(r.confirmacao).toMatchObject({ frete: null, total: 11537.87 })
    expect(r.transformador).toBeUndefined()
    expect(r.valorCliente).toBe(Math.round(11537.87 * 1.6 * 100) / 100)
    expect(r.avisos.join(' ')).toMatch(/frete fica para o operador/)
    expect(textoNota(r)).toMatch(/\(sem frete\)/)
  })
})

describe('chamarBelenus: rota proibida nunca sai', () => {
  it('bloqueia carrinho/pedido/pagamento antes do fetch', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const r of [
      'api/carrinho/KitPersonalizado/ConfirmarCarrinho', 'api/carrinho/KitPersonalizado/ConfirmarCarrinho ',
      'api/carrinho/KitPersonalizado/EnviarHistoricoPedido', 'api/carrinho/KitPersonalizado/AlterarConfirmar',
      'api/carrinho/KitPersonalizado/AlterarCarrinho/false', 'api/carrinho/KitPersonalizado/SalvarOrcamentoCliente/1',
      'api/carrinho/KitPersonalizado/AdicionarFrete', 'api/carrinho/KitPersonalizado/IncluirSeguro',
      'api/carrinho/KitPersonalizado/Cupom', 'api/carrinho/KitPersonalizado/ValidarCupom',
      'api/carrinho/KitPersonalizado/UploadAprovacao', 'api/carrinho/KitPersonalizado/RecarregarCarrinho?tudo=true',
      'api/carrinho/KitPersonalizado/Confirmar/../ConfirmarCarrinho', 'api/carrinho/KitPersonalizado/CarregarFob',
      'api/pedido/x', 'api/pagamento/x', 'https://belenus.com.br/api/planopagamento/x', 'api/fretes/TipoFrete/Outra',
    ])
      await expect(chamarBelenus(r, {}, { token: 't', etapa: 'teste' })).rejects.toThrow(/bloqueada/)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('Fase 4: salvar a cotação na Belenus (Meus orçamentos)', () => {
  it('salva UMA vez depois do Confirmar, com o nome do contato e a cidade do lead, e lê o número WEB', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial', destino: { cidade: 'Niterói', uf: 'RJ' }, nomeCliente: 'Rafael Dias' })
    const iConf = b.urls.findIndex((u) => u.endsWith('KitPersonalizado/Confirmar'))
    const iSalvar = b.urls.findIndex((u) => u.endsWith('KitPersonalizado/SalvarOrcamentoCliente'))
    expect(b.urls.filter((u) => u.endsWith('KitPersonalizado/SalvarOrcamentoCliente'))).toHaveLength(1)
    expect(iSalvar).toBeGreaterThan(iConf)
    const corpo = b.salvarCorpos[0] as { carrinhoJson: Record<string, unknown>; informacoesItens: Record<string, unknown>[] }
    expect(corpo.carrinhoJson).toMatchObject({ nomeOrcamento: 'Rafael Dias', nomeCidadeSelecionada: 'Niterói', ufEstadoSelecionado: 'RJ' })
    expect(corpo.carrinhoJson.frete).toMatchObject({ tipoFreteId: '06', freteIncluso: 600 })
    expect(corpo.informacoesItens[0]).toMatchObject({ sku: 'KIT-SKU' })
    expect(r.cotacaoSalva?.numeroWeb).toBe('WEB-007300123')
    expect(textoNota(r)).toMatch(/Cotação salva na Belenus: WEB-007300123 — preço garantido por 3 dias, até \d{2}\/\d{2}/)
    // 🔒 nada de finalizar pedido, pagamento etc.
    for (const u of b.urls) {
      expect(rotaPermitida(u), u).toBe(true)
      expect(ROTA_PROIBIDA.test(u), u).toBe(false)
      expect(u).not.toMatch(/ConfirmarCarrinho|EnviarHistoricoPedido|AlterarCarrinho|AdicionarFrete|IncluirSeguro|api\/pedido|api\/pagamento|planopagamento/i)
    }
  })

  it('se salvar falhar, a cotação continua e a nota avisa (preço não garantido)', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k], salvarFalha: true })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial' })
    expect(r.confirmacao?.total).toBe(12137.87)
    expect(r.valorCliente).not.toBeNull()
    expect(r.cotacaoSalva).toBeNull()
    expect(textoNota(r)).toMatch(/Não consegui salvar na Belenus — preço não garantido; gere à mão/)
    expect(b.urls.filter((u) => u.endsWith('SalvarOrcamentoCliente'))).toHaveLength(1)
  })

  it('sem total na Confirmação não tenta salvar', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k], confirmarSemTotal: true })
    vi.stubGlobal('fetch', b.fn)
    const r = await montarKitBelenus({ kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial' })
    expect(b.salvarCorpos).toHaveLength(0)
    expect(r.cotacaoSalva).toBeUndefined()
  })
})

describe('Fase 4: dados do cliente na cotação salva', () => {
  it('leva nome e endereço de entrega quando existem; não mexe no cliente de faturamento; nada pessoal no log', async () => {
    const b = belenusFalsa({ inversoresMono: [auxsol3k] })
    vi.stubGlobal('fetch', b.fn)
    await montarKitBelenus({
      kwp: 4.34, ligacao: 'bifásico', tensao: 220, telhado: 'colonial', destino: { cidade: 'Niterói', uf: 'RJ' },
      nomeCliente: 'Rafael Dias da Silva', entrega: { rua: 'Rua das Flores', numero: '37', bairro: 'Centro', cep: '24320-480' },
    })
    const cj = (b.salvarCorpos[0] as { carrinhoJson: Record<string, unknown> }).carrinhoJson
    expect(cj.nomeOrcamento).toBe('Rafael Dias da Silva')
    expect((cj.frete as Record<string, unknown>).enderecoClienteEntrega).toMatchObject({ rua: 'Rua das Flores', numero: '37', bairro: 'Centro', cep: '24320-480', cidade: 'Niterói', estado: 'RJ' })
    expect(cj.clienteCnpjCpf).toBe('00000000000000') // o do carrinho da Belenus (conta do dono), intocado
    const tudo = logs.join('\n')
    for (const pessoal of ['Rafael Dias da Silva', 'Rua das Flores', '24320-480']) expect(tudo).not.toContain(pessoal)
  })
})

describe('tempo limite e novas tentativas (dono, 24/11/2026: Belenus lenta)', () => {
  it('45 s e 1 nova tentativa só nas consultas do catálogo', () => {
    expect(TEMPO_LIMITE_MS).toBe(45_000)
    expect(DEPS_BELENUS).toMatchObject({ tempoLimiteMs: 45_000, novasTentativasConsulta: 1 })
  })
  it('consulta que falha por rede é repetida 1 vez; Confirmar NUNCA é repetido', async () => {
    const f = vi.fn(async () => { throw new TypeError('rede') })
    vi.stubGlobal('fetch', f)
    await expect(chamarBelenus('api/catalogo/KitPersonalizado/Inversor', {}, { token: 't', etapa: 'inversores' })).rejects.toThrow(/Não consegui falar com a Belenus \(etapa: inversores\)/)
    expect(f).toHaveBeenCalledTimes(2)
    f.mockClear()
    await expect(chamarBelenus('api/carrinho/KitPersonalizado/Confirmar', {}, { token: 't', etapa: 'confirmação' })).rejects.toThrow()
    await expect(chamarBelenus('api/carrinho/KitPersonalizado/SalvarOrcamentoCliente', {}, { token: 't', etapa: 'salvar' })).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('acesso negado mantém a dica do Railway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(chamarBelenus('api/catalogo/KitPersonalizado/Modulos', {}, { token: 't', etapa: 'módulos' }))
      .rejects.toThrow('A Belenus recusou o acesso (HTTP 401, etapa: módulos).')
  })
})
