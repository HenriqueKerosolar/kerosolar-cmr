import 'server-only'
import crypto from 'crypto'

/**
 * Conversions API da Meta para anúncios Clique-para-WhatsApp (CTWA).
 * ------------------------------------------------------------------
 * Envia eventos de conversão (Lead qualificado, Venda) de volta para a Meta,
 * ligados ao clique no anúncio pelo `ctwa_clid`. Com isso, a campanha de "Vendas"
 * passa a otimizar por eventos REAIS de qualidade — não só por "conversa iniciada".
 *
 * Credenciais (variáveis de ambiente):
 *   META_CAPI_DATASET_ID  → ID do conjunto de dados (Dataset/Pixel) ligado à sua conta
 *                           WhatsApp Business. Pegue no Gerenciador de Eventos.
 *   META_CAPI_TOKEN       → token de acesso com permissão no dataset. Se ficar vazio,
 *                           usa o WHATSAPP_CLOUD_TOKEN como fallback.
 *
 * Best-effort: nenhuma função aqui lança erro — só loga. O fluxo do CRM nunca quebra
 * por causa de rastreamento.
 */

function graphBase(): string {
  const v = process.env.META_GRAPH_VERSION || 'v21.0'
  return `https://graph.facebook.com/${v}`
}

function datasetId(): string {
  // META_DATASET_ID é o nome novo; mantém META_CAPI_DATASET_ID como fallback compatível.
  return process.env.META_DATASET_ID || process.env.META_CAPI_DATASET_ID || ''
}
function token(): string {
  return process.env.META_CAPI_TOKEN || process.env.WHATSAPP_CLOUD_TOKEN || ''
}

/** SHA-256 no padrão exigido pela Meta (trim + lowercase) para dados pessoais (ex.: telefone). */
function sha256(v: string): string {
  return crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex')
}

export type CapiEvent = {
  /** "Lead", "Purchase", "Contact", "Schedule", "SubmitApplication" ou um evento custom. */
  eventName: 'Lead' | 'Purchase' | 'Contact' | 'Schedule' | 'SubmitApplication' | string
  /** Identificador do clique no anúncio (referral.ctwa_clid). Sem ele não há atribuição. */
  ctwaClid: string
  /** WABA ID (conta WhatsApp Business). Vem de WhatsappAccount.cloudWabaId. */
  wabaId?: string | null
  /** Valor da venda (só para Purchase). */
  value?: number
  /** Moeda (default BRL). */
  currency?: string
  /** ID de deduplicação (ex.: `${leadId}:purchase`). Evita evento contado 2x. */
  eventId?: string
  /** Unix em segundos; default = agora. */
  eventTime?: number
  /** Telefone do contato (opcional). Será hasheado (SHA-256) antes de enviar. */
  phone?: string | null
}

/**
 * Envia um evento de conversão para a Meta. Retorna true se a Meta aceitou.
 * Nunca lança — em caso de erro, apenas registra no log.
 */
export async function sendCapiEvent(ev: CapiEvent): Promise<boolean> {
  const ds = datasetId()
  const tk = token()
  if (!ds || !tk) {
    console.warn('[capi] META_CAPI_DATASET_ID/TOKEN ausentes — evento ignorado:', ev.eventName)
    return false
  }
  if (!ev.ctwaClid) {
    // Lead que não veio de anúncio (sem clid) → não há o que atribuir. Não é erro.
    return false
  }

  const user_data: Record<string, unknown> = { ctwa_clid: ev.ctwaClid }
  if (ev.wabaId) user_data.whatsapp_business_account_id = ev.wabaId
  if (ev.phone) {
    const digits = ev.phone.replace(/\D/g, '')
    if (digits) user_data.ph = [sha256(digits)] // Meta espera ph como array de hashes
  }

  const evento: Record<string, unknown> = {
    event_name: ev.eventName,
    event_time: ev.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data,
  }
  if (ev.eventId) evento.event_id = ev.eventId
  if (typeof ev.value === 'number') {
    evento.custom_data = { currency: ev.currency || 'BRL', value: ev.value }
  }

  try {
    const res = await fetch(`${graphBase()}/${ds}/events?access_token=${encodeURIComponent(tk)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento], partner_agent: 'kerosolar-crm' }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('[capi] Meta rejeitou o evento:', res.status, JSON.stringify(data)?.slice(0, 400))
      return false
    }
    console.log('[capi] evento OK:', ev.eventName, 'received=%s', data?.events_received)
    return true
  } catch (e) {
    console.error('[capi] falha de rede ao enviar evento:', e)
    return false
  }
}
