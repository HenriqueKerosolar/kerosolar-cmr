import { describe, expect, it } from 'vitest'
import { lerComandoIndicacao, lerComandoPlacas } from './comando-indicacao'

describe('lerComandoIndicacao — só "faz XXXX" em kWh ou R$ (regra do dono 16/11/2026)', () => {
  it('"faz XXXX kwh" → por consumo', () => {
    expect(lerComandoIndicacao('Faz 800 kWh')).toEqual({ tipo: 'kwh', valor: 800 })
    expect(lerComandoIndicacao('faz 1.200kwh')).toEqual({ tipo: 'kwh', valor: 1200 })
    expect(lerComandoIndicacao(' faz 450 kw ')).toEqual({ tipo: 'kwh', valor: 450 })
    expect(lerComandoIndicacao('faz 600 kwh híbrido')).toEqual({ tipo: 'kwh', valor: 600 })
  })
  it('"faz R$ XXXX" / "faz XXXX reais" → por valor da conta', () => {
    expect(lerComandoIndicacao('faz R$ 600')).toEqual({ tipo: 'reais', valor: 600 })
    expect(lerComandoIndicacao('faz r$1.250,00')).toEqual({ tipo: 'reais', valor: 1250 })
    expect(lerComandoIndicacao('faz 976 reais')).toEqual({ tipo: 'reais', valor: 976 })
    expect(lerComandoIndicacao('faz para 600 reais')).toEqual({ tipo: 'reais', valor: 600 })
    expect(lerComandoIndicacao('Faz pra R$ 750')).toEqual({ tipo: 'reais', valor: 750 })
    expect(lerComandoIndicacao('faz para 800 kWh')).toEqual({ tipo: 'kwh', valor: 800 })
  })
  it('"faz 800" sem unidade → não adivinha, pede a unidade', () => {
    expect(lerComandoIndicacao('faz 800')).toHaveProperty('erro')
  })
  it('qualquer outra coisa NÃO manda orçamento (incidente 16/11/2026)', () => {
    for (const t of [
      'minha indicação é 800 kWh',
      'kit de 800 kwh',
      'indico 450kw',
      'mando 800 kwh',
      'o outro cliente fez um kit de 800 kwh e economiza bem',
      'Eu fiz para sua conta atual 800 kwh para usar mais um pouco o ar',
      'faz 800 kwh pra ele',
      'ele faz 800 kwh por mês',
      'faz uns 800 reais de conta',
      'faz 800 kwh\nfoi o do outro cliente',
      'faz',
    ]) expect(lerComandoIndicacao(t)).toBeNull()
  })
})

describe('lerComandoPlacas — "faz orçamento N placas de W W com micro e telhado X" (dono 25/11/2026)', () => {
  it('frase do dono', () => {
    expect(lerComandoPlacas('Faz Orçamento 4 placas de 700W com microinversor e telhado ceramico'))
      .toEqual({ placas: 4, potenciaW: 700, micro: true, telhado: 'ceramico', hibrido: false })
  })
  it('variações', () => {
    expect(lerComandoPlacas('faz 10 placas de 620w telhado fibrocimento')).toEqual({ placas: 10, potenciaW: 620, micro: false, telhado: 'fibrocimento', hibrido: false })
    expect(lerComandoPlacas('orçamento de 6 painéis 700 w micro')).toEqual({ placas: 6, potenciaW: 700, micro: true, telhado: null, hibrido: false })
    expect(lerComandoPlacas('faz um orçamento com 8 módulos')).toEqual({ placas: 8, potenciaW: null, micro: false, telhado: null, hibrido: false })
    expect(lerComandoPlacas('Faz orçamento 4 placas de 700W com micro inversor no telhado de cerâmica.')?.telhado).toBe('ceramica')
  })
  it('frases que NÃO são o comando', () => {
    expect(lerComandoPlacas('4 placas de 700W')).toBeNull()
    expect(lerComandoPlacas('faz 800 kwh')).toBeNull()
    expect(lerComandoPlacas('faz orçamento 4 placas para o cliente que mora em niterói')).toBeNull()
    expect(lerComandoPlacas('o vizinho tem 4 placas de 700w')).toBeNull()
  })
})

describe('medidor no fim do comando (26/11/2026, Iara: "Faz 300 Kwh Monofásico" saiu como texto)', () => {
  it('faz kWh/R$ + medidor', () => {
    expect(lerComandoIndicacao('Faz 300 Kwh Monofásico')).toEqual({ tipo: 'kwh', valor: 300, medidor: 'monofásico' })
    expect(lerComandoIndicacao('faz 500 kwh trifasico')).toEqual({ tipo: 'kwh', valor: 500, medidor: 'trifásico' })
    expect(lerComandoIndicacao('faz R$ 400 bifásico')).toEqual({ tipo: 'reais', valor: 400, medidor: 'bifásico' })
    expect(lerComandoIndicacao('faz 300 kwh medidor monofásico')).toEqual({ tipo: 'kwh', valor: 300, medidor: 'monofásico' })
    expect(lerComandoIndicacao('o padrão é monofásico')).toBeNull()
  })
  it('placas + medidor', () => {
    expect(lerComandoPlacas('faz 4 placas de 700w micro monofásico telhado cerâmico')).toEqual({ placas: 4, potenciaW: 700, micro: true, telhado: 'ceramico', hibrido: false, medidor: 'monofásico' })
  })
})

describe('mil e telhado no fim (26/11/2026, Alberto: "8 mil reais telhado cerâmico")', () => {
  it('reais com mil + telhado', () => {
    expect(lerComandoIndicacao('faz orçamento de 8 mil reais telhado ceramico')).toEqual({ tipo: 'reais', valor: 8000, telhado: 'ceramico' })
    expect(lerComandoIndicacao('Faz R$ 8 mil telhado cerâmico')).toEqual({ tipo: 'reais', valor: 8000, telhado: 'cerâmico' })
    expect(lerComandoIndicacao('faz 8.000 reais')).toEqual({ tipo: 'reais', valor: 8000 })
    expect(lerComandoIndicacao('faz R$ 8000 reais')).toEqual({ tipo: 'reais', valor: 8000 })
    expect(lerComandoIndicacao('faz 300 kwh monofásico telhado de fibrocimento')).toEqual({ tipo: 'kwh', valor: 300, medidor: 'monofásico', telhado: 'fibrocimento' })
    expect(lerComandoIndicacao('faz 800 kwh')).toEqual({ tipo: 'kwh', valor: 800 })
    expect(lerComandoIndicacao('o telhado é cerâmico')).toBeNull()
  })
})
