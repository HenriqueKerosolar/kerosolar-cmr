import { describe, it, expect } from 'vitest'
import { ehSaudacaoSimples, clienteJaFalouDeSolar } from './fora-do-assunto'

describe('cumprimento nunca é fora do assunto (Hozana, 19/11/2026)', () => {
  it('reconhece cumprimentos', () => {
    for (const t of ['Bom diaaaa', 'bom dia!', 'Oii', 'Boa tarde, tudo bem?', 'Boa noite 😊', 'olá', 'e aí'])
      expect(ehSaudacaoSimples(t), t).toBe(true)
  })
  it('não confunde com outras mensagens', () => {
    for (const t of ['Bom dia, segue um vídeo engraçado https://tiktok.com/x', 'Deus abençoe sua semana', 'quero orçamento', ''])
      expect(ehSaudacaoSimples(t), t).toBe(false)
  })
  it('cliente que já pediu orçamento', () => {
    expect(clienteJaFalouDeSolar(['Olá! Gostaria de solicitar um orçamento de energia solar.'])).toBe(true)
    expect(clienteJaFalouDeSolar(['kkkk olha isso'])).toBe(false)
  })
})
