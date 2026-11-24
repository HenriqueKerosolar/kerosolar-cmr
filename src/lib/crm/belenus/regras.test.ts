import { describe, expect, it } from 'vitest'
import {
  aplicarRegrasComponentes, calcularCabos, calcularDps, calcularStrings, escolherInversor, escolherModulo600,
  corpoSalvarOrcamento, dimensionarConsumoKeroSolar, formaResposta, geracaoKeroSolar, kwpPorConsumo, lerComandoBelenus, lerConfirmacao, lerDadosCliente, lerDestino, linhaEndereco, lerLigacao, lerTelhado, numeroCotacaoDe, rotaPermitida, type Peca,
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
  it('consumo → kWp pela fórmula do dono (HSP 4,5; perdas 20%; placa de referência 620 W)', () => {
    // exemplo obrigatório: 500 kWh → 4,63 kWp → 8 placas de 620 W → 4,96 kWp → ~535,7 kWh/mês
    expect(kwpPorConsumo(500)).toBe(4.63)
    expect(dimensionarConsumoKeroSolar(500)).toEqual({ kwp: 4.63, placas: 8, kwpKit: 4.96, geracaoMensal: 535.7, geracaoAnual: 6428.2 })
    expect(geracaoKeroSolar(4.96).mensal).toBeCloseTo(4.96 * 4.5 * 30 * 0.8, 1)
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

describe('inversor: AUXSOL 50% → AUXSOL 100% → outras marcas (dono, 24/11/2026)', () => {
  const auxsol = [3, 5, 6, 7.5, 10].map((kw) => ({ item: `A${kw}`, fabricante: 'AUXSOL', potenciaNominalSaida: kw * 1000, numInversores: 1, tipoLigacao: 'Monofásico', tensaoSaida: '220V' }))
  const solis4 = { item: 'S4', fabricante: 'SOLIS', potenciaNominalSaida: 4000, numInversores: 1 }
  const escolhido = (kwp: number) => { const r = escolherInversor([...auxsol, solis4], { kwpKit: kwp }); return 'inversor' in r ? r.inversor.item : r.motivo }
  it('caso real: kit 4,96 kWp bifásico → AUXSOL 3 kW (não SOLIS 4 kW)', () => expect(escolhido(4.96)).toBe('A3'))
  it('mantém: 8 kWp → 6 kW; 4,34 → 3 kW; 9,9 → 7,5 kW', () => {
    expect(escolhido(8)).toBe('A6')
    expect(escolhido(4.34)).toBe('A3')
    expect(escolhido(9.9)).toBe('A7.5')
  })
  it('medidor monofásico continua: limite 5 kW e exceção de 85% (o 100% não vale)', () => {
    const r = escolherInversor(auxsol, { limiteKw: 5, kwpKit: 9.5 })
    expect(r).toEqual({ motivo: 'acima-limite' })
    const ok = escolherInversor(auxsol, { limiteKw: 5, kwpKit: 9 })
    expect('inversor' in ok && ok.inversor.item).toBe('A5')
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
    // Fase 4: salvar a cotação (botão "Salvar" da Confirmação) — caminho exato
    expect(rotaPermitida('https://belenus.com.br/api/carrinho/KitPersonalizado/SalvarOrcamentoCliente')).toBe(true)
    expect(rotaPermitida('https://belenus.com.br/api/carrinho/SalvarOrcamentoCliente')).toBe(false)
    // variações que NÃO podem passar
    for (const r of ['api/carrinho/KitPersonalizado/Confirmar/1', 'api/carrinho/KitPersonalizado/ConfirmarX', 'api/carrinho/Confirmar', 'api/fretes/TipoFrete/Outra'])
      expect(rotaPermitida(`https://belenus.com.br/${r}`), r).toBe(false)
  })
  it('bloqueia para sempre: finalizar pedido, alterar carrinho, pagamento, seguro, frete, cupom, upload e outros hosts', () => {
    for (const r of [
      'api/carrinho/KitPersonalizado/ConfirmarCarrinho', 'api/carrinho/KitPersonalizado/ConfirmarCarrinho ',
      'api/carrinho/KitPersonalizado/EnviarHistoricoPedido', 'api/carrinho/KitPersonalizado/AlterarConfirmar',
      'api/carrinho/KitPersonalizado/AlterarCarrinho/false', 'api/carrinho/KitPersonalizado/SalvarOrcamentoCliente/x',
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

describe('dados do cliente para o orçamento (só o que existir)', () => {
  it('com dados: contato + customFields (chaves reais city/state e chaves de endereço)', () => {
    const d = lerDadosCliente(
      { name: 'Rafa', phone: '5522999233907', email: 'rafa@exemplo.com', customFields: { cep: '28860000' } },
      { city: 'Casimiro de Abreu', state: 'RJ', nomeCompleto: 'Rafael Dias da Silva', logradouro: 'Rua das Flores', numero: '37', bairro: 'Centro', cpf: '12345678900' },
    )
    expect(d).toMatchObject({ nome: 'Rafael Dias da Silva', telefone: '5522999233907', email: 'rafa@exemplo.com', cidade: 'Casimiro de Abreu', uf: 'RJ', cep: '28860-000' })
    expect(linhaEndereco(d.endereco)).toBe('Rua das Flores, 37 - Centro')
    expect(JSON.stringify(d)).not.toContain('12345678900') // CPF nunca entra nos dados do orçamento
  })
  it('sem dados: nada inventado', () => {
    const d = lerDadosCliente({ name: null, phone: null, email: 'invalido' }, {})
    expect(d).toEqual({ nome: null, telefone: null, email: null, cidade: null, uf: null, endereco: null, cep: null })
    expect(linhaEndereco(null)).toBeNull()
  })
  it('cotação salva: endereço de entrega só quando existe', () => {
    const base = { itens: [{ precos: { skuProduto: 'K' } }], frete: { tipoFreteId: null } }
    const com = corpoSalvarOrcamento(base, { nome: 'Rafael', destino: { cidade: 'Niterói', uf: 'RJ' }, entrega: { rua: 'Rua A', numero: '10', bairro: 'Centro', cep: '24320-480' } })
    expect((com.carrinhoJson as { frete: Record<string, unknown> }).frete.enderecoClienteEntrega).toEqual({ rua: 'Rua A', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '24320-480', cidade: 'Niterói', estado: 'RJ' })
    const sem = corpoSalvarOrcamento(base, { nome: 'Rafael', destino: { cidade: 'Niterói', uf: 'RJ' } })
    expect((sem.carrinhoJson as { frete: Record<string, unknown> }).frete.enderecoClienteEntrega).toBeUndefined()
    // nunca troca o cliente (faturamento) do carrinho
    expect(com.carrinhoJson).not.toHaveProperty('clienteCnpjCpf')
  })
})
