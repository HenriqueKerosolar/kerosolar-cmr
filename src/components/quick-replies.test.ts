import { describe, it, expect } from 'vitest'
import { preencher } from './quick-replies'

describe('respostas rápidas: variáveis', () => {
  it('troca {nome} pelo primeiro nome', () => {
    expect(preencher('Oi {nome}, tudo bem?', 'Erik Olsen')).toBe('Oi Erik, tudo bem?')
  })
  it('sem nome válido some com o {nome} e a vírgula', () => {
    expect(preencher('{saudacao}, {nome}! Henrique falando.', '.')).toMatch(/^(Bom dia|Boa tarde|Boa noite)! Henrique falando\.$/)
  })
  it('troca {saudacao}', () => {
    expect(preencher('{saudacao}!', 'Ana')).toMatch(/^(Bom dia|Boa tarde|Boa noite)!$/)
  })
})
