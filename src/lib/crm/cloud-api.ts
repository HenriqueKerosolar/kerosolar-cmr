import 'server-only'

/**
 * API OFICIAL DO WHATSAPP (Meta Cloud API).
 * Envio e recebimento de mensagens pela plataforma oficial — alternativa ao Baileys.
 * Credenciais ficam em variáveis de ambiente (nunca no código/banco):
 *   WHATSAPP_CLOUD_TOKEN     → token de acesso (System User, permanente)
 *   WHATSAPP_APP_SECRET      → p/ validar a assinatura do webhook
 *   WHATSAPP_VERIFY_TOKEN    → o token que você define ao conectar o webhook na Meta
 */

const GRAPH = 'https://graph.facebook.com/v23.0'

function token(): string {
  return process.env.WHATSAPP_CLOUD_TOKEN || ''
}

/** Telefone no formato da Cloud API: só dígitos, com DDI (ex.: 5521999998888). */
function normalizar(phone: string): string {
  const d = (phone || '').replace(/\D/g, '')
  return d.length <= 11 ? `55${d}` : d
}

/** Alterna o 9º dígito de um celular BR (adiciona se faltar, remove se tiver). Usado como retry
 *  quando a Meta recusa o número como "não entregável" (131026) — cobre o descasamento clássico
 *  do 9º dígito entre o número SALVO do contato e o wa_id que a Meta aceita. null se não reconhecer. */
function alternar9Digito(num: string): string | null {
  const d = (num || '').replace(/\D/g, '')
  if (!d.startsWith('55') || d.length < 12) return null
  const ddd = d.slice(2, 4)
  const resto = d.slice(4)
  if (resto.length === 9 && resto.startsWith('9')) return `55${ddd}${resto.slice(1)}` // tem 9 → remove
  if (resto.length === 8) return `55${ddd}9${resto}`                                    // sem 9 → adiciona
  return null
}

/** Códigos de erro da Meta que indicam janela de 24h fechada (exige template de reengajamento).
 *  131026 = Message undeliverable; 131047 = Re-engagement (>24h); 131051 = tipo não suportado fora da janela. */
export const META_ERROR_24H = 131026
export const META_ERRORS_24H = [131026, 131047, 131051]

export class CloudApiError extends Error {
  constructor(public readonly status: number, public readonly metaCode: number | null, msg: string) {
    super(msg)
    this.name = 'CloudApiError'
  }
  get is24hWindow() { return this.metaCode != null && META_ERRORS_24H.includes(this.metaCode) }
}

async function post(phoneNumberId: string, body: object, _retried = false): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const metaCode: number | null = data?.error?.code ?? null
    // 🔁 9º dígito BR: "não entregável" (131026) → tenta UMA vez com/sem o 9 (o wa_id da Meta pode
    //    diferir do número salvo). Resolve "a IA responde mas o envio manual falha".
    const to = (body as { to?: unknown }).to
    if (!_retried && metaCode === 131026 && typeof to === 'string') {
      const alt = alternar9Digito(to)
      if (alt && alt !== to) {
        console.warn('[cloud-api] 131026 — retry com 9º dígito alternado:', to, '->', alt)
        return post(phoneNumberId, { ...body, to: alt }, true)
      }
    }
    console.error('[cloud-api] erro envio:', res.status, metaCode, JSON.stringify(data)?.slice(0, 300))
    throw new CloudApiError(res.status, metaCode, `cloud-api ${res.status} code:${metaCode}`)
  }
  return data?.messages?.[0]?.id ?? null
}

/** Envia texto livre (só funciona dentro da janela de 24h da última msg do cliente). */
export async function sendCloudText(phoneNumberId: string, toPhone: string, text: string): Promise<string | null> {
  return post(phoneNumberId, {
    to: normalizar(toPhone),
    type: 'text',
    text: { body: text, preview_url: true },
  })
}

/** Envia mídia por URL pública (imagem/vídeo/documento). */
export async function sendCloudMedia(
  phoneNumberId: string,
  toPhone: string,
  url: string,
  type: 'image' | 'video' | 'document' | 'audio',
  caption?: string,
): Promise<string | null> {
  const media: Record<string, string> = { link: url }
  if (caption && (type === 'image' || type === 'video')) media.caption = caption
  if (type === 'document' && caption) media.filename = caption
  return post(phoneNumberId, { to: normalizar(toPhone), type, [type]: media })
}

/**
 * Envia um TEMPLATE aprovado (HSM) — necessário FORA da janela de 24h (reengajamento, follow-up).
 * `components` segue o formato da Cloud API (parâmetros do template). Use [] se o template não tem variáveis.
 */
export async function sendCloudTemplate(
  phoneNumberId: string,
  toPhone: string,
  templateName: string,
  lang = 'pt_BR',
  components: object[] = [],
): Promise<string | null> {
  return post(phoneNumberId, {
    to: normalizar(toPhone),
    type: 'template',
    template: { name: templateName, language: { code: lang }, ...(components.length ? { components } : {}) },
  })
}

/** Baixa uma mídia recebida (2 passos: pega a URL temporária pelo media id, depois os bytes). */
export async function downloadCloudMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token()}` } })
    if (!metaRes.ok) return null
    const meta = await metaRes.json() as { url?: string; mime_type?: string }
    if (!meta.url) return null
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token()}` } })
    if (!binRes.ok) return null
    const buffer = Buffer.from(await binRes.arrayBuffer())
    return { buffer, mimeType: meta.mime_type || 'application/octet-stream' }
  } catch (e) {
    console.error('[cloud-api] download mídia falhou:', e)
    return null
  }
}
