import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  MINIMO_KIT_PRECO, TRANSFORMADOR_PRECO, ajustarPorMedidor, aplicarHibrido, aplicarTransformador,
  calcularSolarPorKwh, detectarMedidor, orcamentoTexto, respostaAVista, valorAVista,
} from './solar-calc'
import { matchGlobalFaqRule } from './faq'

// Regras do dono de 16/11/2026 (caso da cliente com medidor monofásico que pediu o valor à vista).
describe('medidor monofásico → transformador', () => {
  it('lê o medidor da conta e da resposta do cliente', () => {
    expect(detectarMedidor('Monofásico')).toBe('monofásico')
    expect(detectarMedidor('MONOFASICO | Light')).toBe('monofásico')
    expect(detectarMedidor('meu medidor é bifásico')).toBe('bifásico')
    expect(detectarMedidor('é trifasico')).toBe('trifásico')
  })

  it('dúvida ou negação não vira informação', () => {
    expect(detectarMedidor('é monofásico ou bifásico?')).toBeNull()
    expect(detectarMedidor('não é monofásico')).toBeNull()
    expect(detectarMedidor('quero um orçamento')).toBeNull()
    expect(detectarMedidor(null)).toBeNull()
  })

  it('soma R$ 600 uma vez só, depois do piso do kit mínimo, e refaz as parcelas', () => {
    const base = calcularSolarPorKwh(300)
    expect(base.valorSistema).toBe(MINIMO_KIT_PRECO)
    const mono = ajustarPorMedidor(base, 'monofásico')
    expect(mono.valorSistema).toBe(MINIMO_KIT_PRECO + TRANSFORMADOR_PRECO)
    expect(mono.transformador).toBe(true)
    expect(mono.menorParcela).toBeGreaterThan(base.menorParcela)
    expect(mono.economiaMensal).toBe(base.economiaMensal)
    expect(aplicarTransformador(mono).valorSistema).toBe(mono.valorSistema)
  })

  it('bifásico, trifásico e medidor desconhecido não mudam o valor', () => {
    const base = calcularSolarPorKwh(600)
    expect(ajustarPorMedidor(base, 'bifásico').valorSistema).toBe(base.valorSistema)
    expect(ajustarPorMedidor(base, 'trifásico').valorSistema).toBe(base.valorSistema)
    expect(ajustarPorMedidor(base, undefined).valorSistema).toBe(base.valorSistema)
  })

  it('no híbrido o transformador não entra no multiplicador, em qualquer ordem', () => {
    const base = calcularSolarPorKwh(600)
    const hibrido = aplicarHibrido(base)
    const a = aplicarTransformador(hibrido)
    const b = aplicarHibrido(aplicarTransformador(base))
    expect(a.valorSistema).toBe(hibrido.valorSistema + TRANSFORMADOR_PRECO)
    expect(b.valorSistema).toBe(a.valorSistema)
    expect(b.transformador).toBe(true)
  })

  it('o orçamento avisa que o transformador está no valor', () => {
    const txt = orcamentoTexto(ajustarPorMedidor(calcularSolarPorKwh(300), 'monofásico'))
    expect(txt).toContain('Sistema completo: R$ 8.270,00')
    expect(txt).toContain('medidor é monofásico')
    expect(orcamentoTexto(calcularSolarPorKwh(300))).not.toContain('monofásico')
  })
})

describe('pagamento à vista', () => {
  it('tira 5% e mostra o valor, sem perguntar e sem repetir o orçamento', () => {
    expect(valorAVista(8270)).toBe(7856.5)
    const r = respostaAVista(8270)
    expect(r).toContain('R$ 8.270,00')
    expect(r).toContain('R$ 7.856,50')
    expect(r).not.toMatch(/quer que eu calcule/i)
    expect(r).not.toContain('ORÇAMENTO SOLAR')
  })

  it('sem orçamento ainda: pede a conta, ou avisa que já está vendo a que chegou', () => {
    expect(respostaAVista(null)).toMatch(/me manda a sua conta/i)
    expect(respostaAVista(null, true)).not.toMatch(/me manda/i)
  })

  it('reconhece o pedido da cliente', () => {
    expect(matchGlobalFaqRule('Eu gostaria de um orçamento de valor a vista ,por favor !')?.id).toBe('a_vista')
    expect(matchGlobalFaqRule('tem desconto no pix?')?.id).toBe('a_vista')
    expect(matchGlobalFaqRule('quando é a vistoria?')).toBeNull()
  })
})

describe('kWh no orçamento quando o cliente manda a conta', () => {
  it('diz quantos kWh por mês ele precisa', () => {
    const txt = orcamentoTexto({ ...calcularSolarPorKwh(520), consumoConta: 520 })
    expect(txt).toContain('você precisa de 520 kWh por mês')
  })

  it('consumo abaixo do menor sistema: mostra os dois números', () => {
    const txt = orcamentoTexto({ ...calcularSolarPorKwh(300), consumoConta: 180 })
    expect(txt).toContain('você precisa de 180 kWh por mês')
    expect(txt).toContain('gera 300 kWh por mês')
  })

  it('sem conta (consumo digitado ou comando do operador) a linha não aparece', () => {
    expect(orcamentoTexto(calcularSolarPorKwh(520))).not.toContain('você precisa de')
  })
})
