import { describe, expect, it } from 'vitest'
import { ehAmpliacao } from './ampliacao'

describe('ehAmpliacao (regra do dono 18/11/2026)', () => {
  it('cliente que já tem sistema e quer ampliar', () => {
    for (const t of [
      'Oi, boa tarde. Tudo bem? Eu já tenho placa solar na minha casa. Eu queria fazer a inclusão de 4 placas solares.',
      'Então, é inclusão de placa, não sei se é outro valor, porque já tem todo o sistema praticamente já instalado, é pra incluir novas quatro placas',
      'Quero ampliar meu sistema solar',
      'Já tenho energia solar e quero colocar mais 6 placas',
      'Gostaria de aumentar minha usina',
      'Fazem ampliação de sistema?',
      'Meu inversor aguenta mais placas, quero adicionar 4 painéis',
    ]) expect(ehAmpliacao(t)).toBe(true)
  })
  it('cliente novo não é ampliação', () => {
    for (const t of [
      'Olá! Gostaria de solicitar um orçamento de energia solar.',
      'Quantas placas eu preciso para 500 kwh?',
      'Minha conta vem 600 reais',
      'Quero colocar placas na minha casa',
      'Vou aumentar meu consumo porque vou comprar ar condicionado',
      '700kw',
    ]) expect(ehAmpliacao(t)).toBe(false)
  })
})
