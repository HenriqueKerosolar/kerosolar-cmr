import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Integração com a API oficial da Meta (Messenger + Instagram Direct).
 * As credenciais ficam em ChannelIntegration (channel = 'facebook' | 'instagram'):
 *   config = { pageId, igId?, pageAccessToken, verifyToken, pipelineId }
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type MetaConfig = {
  pageId: string
  igId?: string
  pageAccessToken: string
  verifyToken: string
  pipelineId?: string
}

export async function getMetaConfig(channel: 'facebook' | 'instagram'): Promise<MetaConfig | null> {
  const row = await prisma.channelIntegration.findUnique({ where: { channel } })
  if (!row || !row.enabled) return null
  return (row.config as unknown as MetaConfig) ?? null
}

/** Envia mensagem de texto para um usuário (PSID no Messenger, IGSID no Instagram). */
export async function sendMetaMessage(channel: 'facebook' | 'instagram', recipientId: string, text: string): Promise<void> {
  const cfg = await getMetaConfig(channel)
  if (!cfg?.pageAccessToken) throw new Error(`${channel} não configurado.`)

  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(cfg.pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  })
  if (!res.ok) throw new Error(`Meta send ${res.status}: ${await res.text()}`)
}

/** Envia mídia por URL (image, video, file). */
export async function sendMetaMedia(channel: 'facebook' | 'instagram', recipientId: string, url: string, type: 'image' | 'video' | 'file'): Promise<void> {
  const cfg = await getMetaConfig(channel)
  if (!cfg?.pageAccessToken) throw new Error(`${channel} não configurado.`)
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(cfg.pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type, payload: { url, is_reusable: true } } },
    }),
  })
  if (!res.ok) throw new Error(`Meta send media ${res.status}: ${await res.text()}`)
}

/** Busca o nome do contato pelo id (best-effort). */
export async function fetchMetaProfile(channel: 'facebook' | 'instagram', userId: string): Promise<string | null> {
  const cfg = await getMetaConfig(channel)
  if (!cfg?.pageAccessToken) return null
  try {
    const res = await fetch(`${GRAPH}/${userId}?fields=name,username&access_token=${encodeURIComponent(cfg.pageAccessToken)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.name || data.username || null
  } catch {
    return null
  }
}
