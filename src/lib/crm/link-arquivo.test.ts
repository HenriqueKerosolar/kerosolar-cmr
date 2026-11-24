import { describe, it, expect, beforeAll } from 'vitest'
import { assinarArquivo, lerTokenArquivo, linkPublicoDoAnexo } from './link-arquivo'

beforeAll(() => { process.env.SESSION_SECRET = 'teste-segredo'; process.env.NEXT_PUBLIC_APP_URL = 'https://crm.exemplo' })

describe('link público assinado de anexo (Instagram/Facebook, 24/11/2026)', () => {
  it('ida e volta', () => {
    const t = assinarArquivo('in_123_45.pdf')
    expect(lerTokenArquivo(t)).toBe('in_123_45.pdf')
  })
  it('token alterado ou vencido não abre', () => {
    const t = assinarArquivo('in_123_45.pdf')
    expect(lerTokenArquivo(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBeNull()
    const outro = assinarArquivo('in_999_1.pdf').split('.')
    const [, exp, sig] = t.split('.')
    expect(lerTokenArquivo(`${outro[0]}.${exp}.${sig}`)).toBeNull()
    const velho = assinarArquivo('in_123_45.pdf', 30, Date.now() - 31 * 86400 * 1000)
    expect(lerTokenArquivo(velho)).toBeNull()
  })
  it('não aceita caminho', () => {
    expect(lerTokenArquivo(assinarArquivo('../segredo.env'))).toBeNull()
  })
  it('monta a URL a partir do anexo salvo', () => {
    const u = linkPublicoDoAnexo('https://crm.exemplo/api/uploads/in_1_2.pdf', 'Guia Anti-Cilada.pdf')!
    expect(u.startsWith('https://crm.exemplo/api/arquivo/')).toBe(true)
    expect(u.endsWith('/Guia-Anti-Cilada.pdf')).toBe(true)
    expect(linkPublicoDoAnexo('https://outro/x.pdf')).toBeNull()
  })
})
