import { describe, expect, it } from 'vitest'
import { ehProfissionalOferecendoTrabalho } from './profissional'

describe('ehProfissionalOferecendoTrabalho (regra do dono 18/11/2026)', () => {
  it('profissional oferecendo trabalho', () => {
    for (const t of [
      'Boa noite vcs tão precisando de instalador Freelance',
      'Vocês precisam de eletricista?',
      'Estão contratando instalador?',
      'Sou instalador de energia solar com 5 anos de experiência',
      'Trabalho como montador de placas',
      'Tenho equipe de instalação, posso ajudar',
      'Gostaria de trabalhar com vocês',
      'Tem vaga?',
      'Posso mandar meu currículo?',
    ]) expect(ehProfissionalOferecendoTrabalho(t)).toBe(true)
  })
  it('cliente comum não é profissional', () => {
    for (const t of [
      'Olá! Posso ter mais informações sobre isso?',
      'Quero um orçamento para 450 kwh',
      'Vocês fazem a instalação também?',
      'Quanto tempo leva a instalação?',
      'O técnico vem quando?',
      'Você pode me informar se fazem revisão.',
      'Minha conta vem 600 reais',
    ]) expect(ehProfissionalOferecendoTrabalho(t)).toBe(false)
  })
})
