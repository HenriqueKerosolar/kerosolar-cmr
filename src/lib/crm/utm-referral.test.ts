import { describe, expect, it } from 'vitest'
import { extractUtmReferral } from './utm-referral'

const now = () => new Date('2026-11-05T12:00:00.000Z')

describe('extractUtmReferral', () => {
  it('extrai utm_* e preserva a landingUrl e o instante da captura', () => {
    const r = extractUtmReferral('https://keroservice.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=solar-sp', now)
    expect(r).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'solar-sp',
      landingUrl: 'https://keroservice.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=solar-sp',
      capturedAt: '2026-11-05T12:00:00.000Z',
    })
  })

  it('extrai gclid/gbraid/wbraid (Google Ads) e fbclid (Meta)', () => {
    const r = extractUtmReferral('https://keroservice.com.br/?gclid=abc123&fbclid=xyz789', now)
    expect(r).toMatchObject({ gclid: 'abc123', fbclid: 'xyz789' })
    expect(r).not.toHaveProperty('gbraid')
    expect(r).not.toHaveProperty('wbraid')
  })

  it('devolve null quando a URL não tem nenhum campo de atribuição conhecido', () => {
    expect(extractUtmReferral('https://keroservice.com.br/contato', now)).toBeNull()
  })

  it('devolve null quando landingUrl está ausente', () => {
    expect(extractUtmReferral(undefined, now)).toBeNull()
    expect(extractUtmReferral(null, now)).toBeNull()
    expect(extractUtmReferral('', now)).toBeNull()
  })

  it('devolve null (nunca lança) quando landingUrl não é uma URL válida', () => {
    expect(extractUtmReferral('isso não é url nenhuma', now)).toBeNull()
  })
})
