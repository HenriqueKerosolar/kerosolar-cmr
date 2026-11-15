import { describe, expect, it } from 'vitest'
import { iconeCanal } from './canal-icone'

describe('iconeCanal — origem Instagram/Facebook sempre visível (regra do dono 15/11/2026)', () => {
  it('lead do Instagram que foi para o WhatsApp mostra os dois símbolos', () => {
    expect(iconeCanal('whatsapp', 'instagram')).toEqual({ icone: '📷→🟢', titulo: 'Veio do Instagram e agora conversa pelo WhatsApp' })
    expect(iconeCanal('whatsapp', 'facebook').icone).toBe('💬→🟢')
  })
  it('conversa no próprio canal de origem mostra só ele', () => {
    expect(iconeCanal('instagram', 'instagram').icone).toBe('📷')
    expect(iconeCanal('whatsapp', 'whatsapp').icone).toBe('🟢')
    expect(iconeCanal('whatsapp', null).icone).toBe('🟢')
  })
  it('origem do site não vira seta (só Instagram/Facebook)', () => {
    expect(iconeCanal('whatsapp', 'webchat').icone).toBe('🟢')
  })
})
