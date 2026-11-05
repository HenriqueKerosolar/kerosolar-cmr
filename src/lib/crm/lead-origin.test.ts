import { describe, expect, it } from 'vitest'
import { summarizeLeadOrigin } from './lead-origin'

describe('summarizeLeadOrigin', () => {
  it('prioriza o anúncio do clique-pra-WhatsApp (adReferral) quando existe', () => {
    const r = summarizeLeadOrigin({ adReferral: { headline: 'Energia solar sem entrada', source_url: 'https://fb.me/x' } })
    expect(r).toEqual({ label: '📣 Anúncio (clique no WhatsApp)', detail: 'Energia solar sem entrada' })
  })

  it('usa a origem do site (utm_source/campaign) quando não tem adReferral', () => {
    const r = summarizeLeadOrigin({ utmReferral: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'solar-sp' } })
    expect(r).toEqual({ label: '📣 Anúncio (site)', detail: 'google · cpc · solar-sp' })
  })

  it('cai pro clique id (gclid/fbclid) quando não tem utm_source nem utm_campaign', () => {
    expect(summarizeLeadOrigin({ utmReferral: { gclid: 'abc', landingUrl: 'https://x.com/?gclid=abc' } })).toEqual({
      label: '📣 Google Ads (clique)',
      detail: 'https://x.com/?gclid=abc',
    })
    expect(summarizeLeadOrigin({ utmReferral: { fbclid: 'xyz' } })?.label).toBe('📣 Meta Ads (clique)')
  })

  it('nunca fabrica uma origem: sem nenhum dado, devolve null', () => {
    expect(summarizeLeadOrigin(null)).toBeNull()
    expect(summarizeLeadOrigin(undefined)).toBeNull()
    expect(summarizeLeadOrigin({})).toBeNull()
    expect(summarizeLeadOrigin({ adReferral: {}, utmReferral: {} })).toBeNull()
    expect(summarizeLeadOrigin({ adReferral: { source_type: 'ad' } })).toBeNull() // sem headline/url, não inventa
  })
})
