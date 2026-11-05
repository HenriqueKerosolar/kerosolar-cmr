import { describe, expect, it } from 'vitest'
import { summarizeQualification } from './lead-qualification'

// toLocaleString('pt-BR', {style:'currency'}) usa espaço NÃO quebrável (U+00A0) entre "R$" e o número.
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

describe('summarizeQualification', () => {
  it('mostra valor da conta e cidade quando os dois existem', () => {
    expect(summarizeQualification({ billValue: 450, city: 'São Paulo' })).toBe(`${brl(450)}/mês · São Paulo`)
  })

  it('mostra só o que existir', () => {
    expect(summarizeQualification({ billValue: 300 })).toBe(`${brl(300)}/mês`)
    expect(summarizeQualification({ city: 'Campinas' })).toBe('Campinas')
  })

  it('nunca mostra placeholder: sem dado nenhum, devolve null', () => {
    expect(summarizeQualification(null)).toBeNull()
    expect(summarizeQualification(undefined)).toBeNull()
    expect(summarizeQualification({})).toBeNull()
    expect(summarizeQualification({ city: '   ' })).toBeNull()
    expect(summarizeQualification({ billValue: 0 })).toBeNull()
  })

  it('ignora tipos inesperados em vez de quebrar', () => {
    expect(summarizeQualification({ billValue: 'muito', city: 42 } as unknown as Record<string, unknown>)).toBeNull()
  })
})
