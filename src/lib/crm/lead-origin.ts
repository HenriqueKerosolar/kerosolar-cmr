// Resume a origem real do lead pra exibir na tela — hoje o CRM já captura `ctwaClid`/`adReferral`
// (clique-pra-WhatsApp da Meta) e `utmReferral` (utm/gclid/fbclid da landing page do chat do site), mas
// nunca mostra isso pro humano (só é usado internamente pro CAPI). NUNCA fabrica "origem desconhecida":
// sem dado nenhum, devolve `null` e a tela simplesmente não mostra a seção.

export interface LeadOriginContact {
  adReferral?: unknown
  utmReferral?: unknown
}

export interface LeadOriginSummary {
  /** Rótulo curto pra exibir (ex.: "📣 Anúncio (WhatsApp)", "📣 Google Ads"). */
  label: string
  /** Detalhe opcional (nome do anúncio/campanha, ou a URL de origem). */
  detail?: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function summarizeLeadOrigin(contact: LeadOriginContact | null | undefined): LeadOriginSummary | null {
  if (!contact) return null

  const ad = asRecord(contact.adReferral)
  if (ad) {
    const headline = str(ad.headline)
    const sourceUrl = str(ad.source_url)
    if (headline || sourceUrl) return { label: '📣 Anúncio (clique no WhatsApp)', detail: headline ?? sourceUrl }
  }

  const utm = asRecord(contact.utmReferral)
  if (utm) {
    const source = str(utm.utm_source)
    const campaign = str(utm.utm_campaign)
    const medium = str(utm.utm_medium)
    if (source || campaign) {
      const parts = [source, medium, campaign].filter(Boolean)
      return { label: '📣 Anúncio (site)', detail: parts.join(' · ') }
    }
    // Só clique id, sem utm_source/campaign (ex.: link de anúncio sem parâmetros utm).
    if (str(utm.gclid)) return { label: '📣 Google Ads (clique)', detail: str(utm.landingUrl) }
    if (str(utm.fbclid)) return { label: '📣 Meta Ads (clique)', detail: str(utm.landingUrl) }
  }

  return null
}
