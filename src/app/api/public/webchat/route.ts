import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ingestMessage } from '@/lib/crm/engine'

/**
 * API pública do chat do site (canal "webchat").
 * O widget do site chama estes endpoints:
 *   POST /api/public/webchat   { visitorId, name?, text }  → processa e devolve a resposta
 *   GET  /api/public/webchat?visitorId=...&after=<iso>     → busca mensagens novas (polling)
 *
 * Proteção: header "x-api-key" deve bater com WEBCHAT_API_KEY. CORS liberado p/ o site.
 */

const ALLOWED_ORIGIN = process.env.WEBCHAT_ORIGIN || '*'

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
  return res
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

function checkKey(req: NextRequest): boolean {
  const key = process.env.WEBCHAT_API_KEY
  if (!key) return true // se não configurado, não bloqueia (dev)
  return req.headers.get('x-api-key') === key
}

export async function POST(req: NextRequest) {
  if (!checkKey(req)) return cors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
  let body: { visitorId?: string; name?: string; text?: string }
  try { body = await req.json() } catch { return cors(NextResponse.json({ error: 'json inválido' }, { status: 400 })) }

  const visitorId = (body.visitorId || '').trim()
  const text = (body.text || '').trim().slice(0, 2000)
  if (!visitorId || !text) return cors(NextResponse.json({ error: 'visitorId e text são obrigatórios' }, { status: 400 }))

  try {
    const result = await ingestMessage({
      channel: 'webchat',
      externalId: visitorId,
      text,
      name: body.name?.trim() || null,
    })
    return cors(NextResponse.json({ reply: result.reply, handoff: result.handoff }))
  } catch (err) {
    console.error('[webchat POST]', err)
    return cors(NextResponse.json({ error: 'erro ao processar' }, { status: 500 }))
  }
}

export async function GET(req: NextRequest) {
  if (!checkKey(req)) return cors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
  const url = new URL(req.url)
  const visitorId = url.searchParams.get('visitorId') || ''
  const after = url.searchParams.get('after')
  if (!visitorId) return cors(NextResponse.json({ error: 'visitorId obrigatório' }, { status: 400 }))

  const conv = await prisma.conversation.findFirst({
    where: { channel: 'webchat', contact: { phone: visitorId } },
    orderBy: { lastMessageAt: 'desc' },
  })
  if (!conv) return cors(NextResponse.json({ messages: [] }))

  const messages = await prisma.message.findMany({
    where: {
      conversationId: conv.id,
      direction: 'outbound', // só o que o CRM/IA/atendente respondeu
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, content: true, senderType: true, createdAt: true },
  })
  return cors(NextResponse.json({ messages }))
}
