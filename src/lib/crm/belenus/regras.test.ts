import { describe, expect, it } from 'vitest'
import {
  aplicarRegrasComponentes, calcularCabos, calcularDps, calcularStrings, escolherInversor, escolherModulo600,
  formaResposta, kwpPorConsumo, lerComandoBelenus, lerConfirmacao, lerDestino, lerLigacao, lerTelhado, numeroCotacaoDe, rotaPermitida, type Peca,
} from './regras'

describe('lerComandoBelenus — "cota belenus <kWp>" (mensagem inteira)', () => {
  it('aceita vírgula, ponto, com e sem kWp', () => {
    for (const t of ['cota belenus 4,34', 'cota belenus 4.34', 'Cota Belenus 4,34 kWp', 'cota belenus 4.34kwp', 'cota belenus 4,34 KWP.'])
      expect(lerComandoBelenus(t)).toEqual({ kwp: 4.34 })
    expect(lerComandoBelenus('cota belenus 10 kwp')).toEqual({ kwp: 10 })
  })
  it('"cota belenus" sozinho → usa o consumo do lead', () => {
    expect(lerComandoBelenus('cota belenus')).toEqual({ kwp: null })
    expect(lerComandoBelenus('  Cota Belenus  ')).toEqual({ kwp: null })
  })
  it('potência ilegível ou zero → erro claro (nada vai ao cliente)', () => {
    expect(lerComandoBelenus('cota belenus quatro')).toHaveProperty('erro')
    expect(lerComandoBelenus('cota belenus 0 kwp')).toHaveProperty('erro')
  })
  it('qualquer outra frase NÃO é comando', () => {
    expect(lerComandoBelenus('vou cotar na belenus amanhã')).toBeNull()
    expect(lerComandoBelenus('a belenus cota 4,34 kwp')).toBeNull()
    expect(lerComandoBelenus('faz 800 kwh')).toBeNull()
  })
})

describe('dados do lead', () => {
  it('consumo → kWp (1 painel = 60 kWh, painel de 620 W)', () => {
    expect(kwpPorConsumo(420)).toBe(4.34)
    expect(kwpPorConsumo(421)).toBe(4.96)
    expect(kwpPorConsumo(0)).toBe(0)
  })
  it('medidor e telhado', () => {
    expect(lerLigacao('Monofásico')).toBe('monofásico')
    expect(lerLigacao('bifasico')).toBe('bifásico')
    expect(lerLigacao('TRIFÁSICO')).toBe('trifásico')
    expect(lerLigacao('')).toBeNull()
    expect(lerTelhado('Eternit')).toBe('fibrocimento')
    expect(lerTelhado('telha colonial')).toBe('colonial')
    expect(lerTelhado('metálico')).toBe('metálico')
    expect(lerTelhado('laje')).toBe('laje')
    expect(lerTelhado(undefined)).toBeNull()
  })
})

describe('módulo: primeiro da faixa de 600 W na ordem do site', () => {
  it('pula os de 550 W e 700 W e respeita o index (menor preço)', () => {
    const m = escolherModulo600([
      { item: 'A', potencia: 550, index: 1 },
      { item: 'B', potencia: 700, index: 2 },
      { item: 'C', potencia: 610, index: 4 },
      { item: 'D', potencia: 620, index: 3 },
    ])
    expect(m?.item).toBe('D')
  })
  it('sem módulo de 600 W → null', () => {
    expect(escolherModulo600([{ item: 'A', potencia: 550 }, { item: 'B', potencia: 0.585 }])).toBeNull()
  })
  it('aceita potência em kW (0,62)', () => {
    expect(escolherModulo600([{ item: 'X', potencia: 0.62 }])?.item).toBe('X')
  })
})

describe('inversor: AUXSOL, 1 só, monofásico até 5 kW', () => {
  it('prefere AUXSOL mesmo que outro venha antes', () => {
    const r = escolherInversor([
      { item: 'G', fabricante: 'GROWATT', potenciaNominalSaida: 3000, numInversores: 1, index: 1 },
      { item: 'A', fabricante: 'AUXSOL', potenciaNominalSaida: 3000, numInversores: 1, index: 2 },
    ])
    expect('inversor' in r && r.inversor.item).toBe('A')
  })
  it('mais de 1 inversor sugerido → pede trifásico', () => {
    expect(escolherInversor([{ item: 'A', fabricante: 'AUXSOL', potenciaNominalSaida: 5000, numInversores: 2 }])).toEqual({ motivo: 'mais-de-um' })
  })
  it('monofásico acima de 5 kW → acima do limite', () => {
    expect(escolherInversor([{ item: 'A', potenciaNominalSaida: 6000, numInversores: 1 }], { limiteKw: 5 })).toEqual({ motivo: 'acima-limite' })
    const ok = escolherInversor([{ item: 'A', potenciaNominalSaida: 6, numInversores: 1 }, { item: 'B', potenciaNominalSaida: 5, numInversores: 1 }], { limiteKw: 5 })
    expect('inversor' in ok && ok.inversor.item).toBe('B')
  })
})

describe('strings, cabos e DPS (regra do dono)', () => {
  it('1 string = 8 painéis', () => {
    expect(calcularStrings(7)).toBe(1)
    expect(calcularStrings(8)).toBe(1)
    expect(calcularStrings(9)).toBe(2)
    expect(calcularStrings(17)).toBe(3)
  })
  it('25 m preto + 25 m vermelho por string; verde 25 m com 1 string, senão metade do vermelho', () => {
    expect(calcularCabos(1)).toEqual({ preto: 25, vermelho: 25, verde: 25 })
    expect(calcularCabos(2)).toEqual({ preto: 50, vermelho: 50, verde: 25 })
    expect(calcularCabos(3)).toEqual({ preto: 75, vermelho: 75, verde: 38 })
  })
  it('DPS: 2 mono/bifásico, 3 trifásico', () => {
    expect(calcularDps('monofásico')).toBe(2)
    expect(calcularDps('bifásico')).toBe(2)
    expect(calcularDps('trifásico')).toBe(3)
  })
  it('troca cabo de 4 mm pelo de 6 mm do catálogo e ajusta quantidades', () => {
    const p = (codigo: string, descricao: string, qtde: number): Peca => ({ codigo, descricao, qtde, preco: null })
    const sug = [p('C4P', 'CABO SOLAR 4MM PRETO', 50), p('C4V', 'CABO SOLAR 4MM VERMELHO', 50), p('D', 'DPS CC 1000V', 1), p('MC4', 'CONECTOR MC4', 2)]
    const todos = [p('C6P', 'CABO SOLAR 6MM PRETO', 0), p('C6V', 'CABO SOLAR 6MM VERMELHO', 0), p('CVD', 'CABO VERDE 6MM', 0)]
    const { pecas, ajustes } = aplicarRegrasComponentes(sug, todos, 2, 'trifásico')
    const q = (c: string) => pecas.find((x) => x.codigo === c)?.qtde
    expect(q('C4P')).toBeUndefined()
    expect(q('C4V')).toBeUndefined()
    expect(q('C6P')).toBe(50)
    expect(q('C6V')).toBe(50)
    expect(q('CVD')).toBe(25)
    expect(q('D')).toBe(3)
    expect(q('MC4')).toBe(2)
    expect(ajustes.join('\n')).toMatch(/DPS: 1 → 3/)
  })
})

describe('rotas: só consulta do catálogo', () => {
  it('permite as consultas do Gerador Personalizado', () => {
    for (const r of ['Modulos', 'InversorFiltro', 'Inversor', 'TodosInversores', 'ConferirPotenciaInversor', 'TipoEstrutura', 'Estrutura', 'Outros', 'OutrosAC', 'StringBox/0001'])
      expect(rotaPermitida(`https://belenus.com.br/api/catalogo/KitPersonalizado/${r}`)).toBe(true)
    expect(rotaPermitida('https://belenus.com.br/api/autenticacao/Usuario/Login/PessoaJuridicaByEmail')).toBe(true)
  })
  it('Fase 2: libera SÓ a etapa 6 (Confirmar) e as leituras de seguro e frete, por caminho exato', () => {
    expect(rotaPermitida('https://belenus.com.br/api/carrinho/KitPersonalizado/Confirmar')).toBe(true)
    expect(rotaPermitida('https://belenus.com.br/api/carrinho/KitPersonalizado/ValorSeguro')).toBe(true)
    expect(rotaPermitida('https://belenus.com.br/api/fretes/TipoFrete/BuscarFretes?calcularValores=true')).toBe(true)
    // variações que NÃO podem passar
    for (const r of ['api/carrinho/KitPersonalizado/Confirmar/1', 'api/carrinho/KitPersonalizado/ConfirmarX', 'api/carrinho/Confirmar', 'api/fretes/TipoFrete/Outra'])
      expect(rotaPermitida(`https://belenus.com.br/${r}`), r).toBe(false)
  })
  it('bloqueia para sempre: finalizar pedido, alterar carrinho, pagamento, seguro, frete, cupom, upload e outros hosts', () => {
    for (const r of [
      'api/carrinho/KitPersonalizado/ConfirmarCarrinho', 'api/carrinho/KitPersonalizado/ConfirmarCarrinho ',
      'api/carrinho/KitPersonalizado/EnviarHistoricoPedido', 'api/carrinho/KitPersonalizado/AlterarConfirmar',
      'api/carrinho/KitPersonalizado/AlterarCarrinho/false', 'api/carrinho/KitPersonalizado/SalvarOrcamentoCliente',
      'api/carrinho/KitPersonalizado/IncluirSeguro', 'api/carrinho/KitPersonalizado/RecarregarCarrinho?tudo=true',
      'api/carrinho/KitPersonalizado/AdicionarFrete', 'api/carrinho/KitPersonalizado/Cupom', 'api/carrinho/KitPersonalizado/ValidarCupom',
      'api/carrinho/KitPersonalizado/CarregarFob', 'api/carrinho/KitPersonalizado/AtualizarQuantidade',
      'api/carrinho/KitPersonalizado/UploadFinanciamento', 'api/pagamento/qualquer', 'api/pedido/qualquer',
      'api/planopagamento/x', 'api/carrinho/KitPersonalizado/Confirmar?x=ConfirmarCarrinho',
      'api/catalogo/KitPersonalizado/BuscarModuloInvertido', 'api/catalogo/KitPersonalizado/Confirmar',
    ]) expect(rotaPermitida(`https://belenus.com.br/${r}`), r).toBe(false)
    expect(rotaPermitida('https://outro.com/api/catalogo/KitPersonalizado/Modulos')).toBe(false)
  })
})

describe('formaResposta (log) nunca mostra dado sensível', () => {
  it('troca valores sensíveis pelo tipo e resume listas', () => {
    const f = JSON.stringify(formaResposta({ token: 'abc.def.ghi', data: { email: 'x@y.z', cnpj: '123', modulos: [{ item: 'M1', descricaoItem: 'Painel', potencia: 620, extra: 1 }, {}, {}] } }))
    expect(f).not.toContain('abc.def.ghi')
    expect(f).not.toContain('x@y.z')
    expect(f).toContain('"lista":3')
    expect(f).toContain('"item":"M1"')
  })
})

describe('Fase 2: leitura da Confirmação', () => {
  it('número da cotação no formato WEB-xxxxxxxxx', () => {
    expect(numeroCotacaoDe({ pedidoWeb: 7268278 })).toBe('WEB-007268278')
    expect(numeroCotacaoDe({ pedidoWeb: 'WEB-007268278' })).toBe('WEB-007268278')
    expect(numeroCotacaoDe({ pedidoWeb: 0 })).toBeNull()
    expect(numeroCotacaoDe({})).toBeNull()
  })
  it('total = produtos + frete + seguro (exemplo do dono: R$ 12.137,87); impostos listados à parte', () => {
    const c = lerConfirmacao({ isSucceed: true, data: { pedidoWeb: 7268278, totalProdutos: 11445.78, valorDifal: 10, status: 3 } }, { frete: { valor: 600, descricao: 'Belenus Entrega no Cliente' }, seguro: 92.09 })
    expect(c).toMatchObject({ numeroCotacao: 'WEB-007268278', totalProdutos: 11445.78, frete: 600, seguro: 92.09, total: 12137.87 })
    expect(c.impostos).toEqual([{ nome: 'valorDifal', valor: 10 }])
  })
  it('sem totalProdutos → erro claro', () => {
    expect(() => lerConfirmacao({ isSucceed: true, data: {} })).toThrow(/não devolveu o total dos produtos/)
  })
  it('destino do frete: cidade do lead (com ou sem UF)', () => {
    expect(lerDestino('Niterói - RJ')).toEqual({ cidade: 'Niterói', uf: 'RJ' })
    expect(lerDestino('Belo Horizonte', 'mg')).toEqual({ cidade: 'Belo Horizonte', uf: 'MG' })
    expect(lerDestino('Petrópolis')).toEqual({ cidade: 'Petrópolis', uf: 'RJ' })
    expect(lerDestino('')).toBeNull()
  })
})
