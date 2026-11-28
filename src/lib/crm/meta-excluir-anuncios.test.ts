import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { createHash } from 'crypto'
import { excluirDosAnuncios, hashTelefone } from './meta-excluir-anuncios'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('público de exclusão dos anúncios (28/11/2026)', () => {
  it('telefone vira SHA-256 com DDI 55, só dígitos', () => {
    expect(hashTelefone('5521983740267')).toBe(sha('5521983740267'))
    expect(hashTelefone('(21) 98374-0267')).toBe(sha('5521983740267'))
    expect(hashTelefone('+55 21 98374-0267')).toBe(sha('5521983740267'))
    expect(hashTelefone('123')).toBeNull()
    expect(hashTelefone(null)).toBeNull()
  })
  it('sem token não faz nada', async () => {
    delete process.env.META_ADS_TOKEN
    expect(await excluirDosAnuncios('5521983740267')).toBe('sem-token')
  })
})
