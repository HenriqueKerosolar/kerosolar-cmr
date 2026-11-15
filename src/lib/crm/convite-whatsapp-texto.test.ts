import { describe, expect, it } from 'vitest'
import { extrairCodigoConvite, gerarCodigoConvite, interesseReal, linkConviteWhatsapp, linkConviteWhatsappDireto } from './convite-whatsapp-texto'

describe('interesseReal (regra do dono 15/11/2026)', () => {
  it('mandou a conta (arquivo) → interesse', () => expect(interesseReal('', true)).toBe(true))
  it('orçamento por kWh', () => {
    expect(interesseReal('faz um orçamento pra 450 kwh', false)).toBe(true)
    expect(interesseReal('meu consumo é 1.200kWh', false)).toBe(true)
  })
  it('orçamento por R$', () => {
    expect(interesseReal('minha conta vem R$ 600', false)).toBe(true)
    expect(interesseReal('pago uns 380 reais', false)).toBe(true)
  })
  it('vai conversar com a esposa/marido/família', () => {
    expect(interesseReal('Vou conversar com a minha esposa e te falo', false)).toBe(true)
    expect(interesseReal('preciso ver com meu marido', false)).toBe(true)
    expect(interesseReal('vou falar com a família', false)).toBe(true)
  })
  it('conversa comum não dispara', () => {
    expect(interesseReal('oi, bom dia', false)).toBe(false)
    expect(interesseReal('como funciona a energia solar?', false)).toBe(false)
    expect(interesseReal('tenho 2 filhos', false)).toBe(false)
  })
})

describe('código do convite', () => {
  it('gera 5 caracteres sem 0/O/1/I/L', () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigoConvite()).toMatch(/^[A-HJKMNP-Z2-9]{5}$/)
  })
  it('o link é curto, no domínio da KeroSolar', () => {
    expect(linkConviteWhatsapp('K7F2X', 'instagram')).toBe('https://kerosolar.com.br/w/K7F2X')
  })
  it('a mensagem que o site deixa pronta no WhatsApp devolve o mesmo código', () => {
    // mesmo texto do redirecionamento do site (kerosolar-site: src/app/w/[code]/route.ts)
    expect(extrairCodigoConvite('Olá! Quero continuar meu atendimento. Código: K7F2X')).toBe('K7F2X')
    const direto = linkConviteWhatsappDireto('K7F2X')
    expect(direto).toMatch(/^https:\/\/wa\.me\/552120276013\?text=/)
    expect(extrairCodigoConvite(decodeURIComponent(direto.split('text=')[1]))).toBe('K7F2X')
  })
  it('sem código → null', () => {
    expect(extrairCodigoConvite('Olá, quero um orçamento')).toBeNull()
    expect(extrairCodigoConvite('codigo de barras 1234567890')).toBeNull()
  })
})
