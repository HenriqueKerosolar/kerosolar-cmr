import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ingestMessage } from '@/lib/crm/engine'
import { getMetaConfig, sendMetaMessage, fetchMetaProfile } from '@/lib/crm/meta'

/**
 * Webhook da Meta (Messenger + Instagram).
 * GET  = verificação do webhook (Meta envia hub.challenge)
 * POST = recebe mensagens
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  // aceita se o token bater com o de qualquer canal configurado
  const [fb, ig] = await Promise.all([getMetaConfig('facebook'), getMetaConfig('instagram')])
  const validTokens = [fb?.verifyToken, ig?.verifyToken].filter(Boolean)

  if (mode === 'subscribe' && token && validTokens.includes(token)) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const channel: 'facebook' | 'instagram' = body.object === 'instagram' ? 'instagram' : 'facebook'
  const cfg = await getMetaConfig(channel)

  // Responde 200 rápido sempre (exigência da Meta); processa best-effort
  try {
    for (const entry of body.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        if (ev.message?.is_echo) continue
        const senderId: string = ev.sender?.id
        const text: string =
          ev.message?.text ||
          ev.message?.attachments?.[0]?.payload?.url ||
          ''
        if (!senderId || !text.trim()) continue

        const name = await fetchMetaProfile(channel, senderId).catch(() => null)

        const result = await ingestMessage({
          channel,
          externalId: senderId,
          text: text.trim(),
          name,
          pipelineId: cfg?.pipelineId,
          externalMessageId: ev.message?.mid,
        })

        if (result.reply) {
          await sendMetaMessage(channel, senderId, result.reply).catch((e) => console.error('[meta reply]', e))
        }
      }
    }
  } catch (e) {
    console.error('[meta webhook]', e)
  }

  return NextResponse.json({ ok: true })
}
