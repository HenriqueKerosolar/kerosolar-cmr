// Extrai utm_source/utm_medium/utm_campaign/utm_term/utm_content (Google/geral), gclid/gbraid/wbraid
// (Google Ads) e fbclid (Meta) da querystring da página onde o visitante abriu o chat do site. Usado
// pra ligar o lead à campanha de anúncio real, do mesmo jeito que o ctwaClid já liga o clique-pra-WhatsApp.
// Guardado em Contact.utmReferral — NUNCA inventa um valor: campo ausente na URL = ausente no objeto.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid'] as const

export interface UtmReferral {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  landingUrl: string
  capturedAt: string
}

/** `null` quando `landingUrl` é inválida/ausente ou não tem nenhum campo de atribuição conhecido. */
export function extractUtmReferral(landingUrl: string | undefined | null, now: () => Date = () => new Date()): UtmReferral | null {
  if (!landingUrl) return null
  let params: URLSearchParams
  try {
    params = new URL(landingUrl).searchParams
  } catch {
    return null
  }

  const out: Record<string, string> = {}
  for (const key of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
    const v = params.get(key)
    if (v) out[key] = v
  }
  if (Object.keys(out).length === 0) return null

  return { ...out, landingUrl, capturedAt: now().toISOString() } as UtmReferral
}
