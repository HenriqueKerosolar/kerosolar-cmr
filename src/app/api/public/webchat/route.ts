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
  let body: { visitorId?: string; name?: string; text?: string; phone?: string; email?: string; city?: string; source?: string }
  try { body = await req.json() } catch { return cors(NextResponse.json({ error: 'json inválido' }, { status: 400 })) }

  const visitorId = (body.visitorId || '').trim()
  const text = (body.text || '').trim().slice(0, 2000)
  if (!visitorId || !text) return cors(NextResponse.json({ error: 'visitorId e text são obrigatórios' }, { status: 400 }))

  // Dados opcionais do lead (o site pode mandar já na primeira mensagem)
  const limpa = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '') || null
  const nome = limpa(body.name, 120)
  const telefone = limpa(body.phone, 30)
  const email = limpa(body.email, 160)
  const cidade = limpa(body.city, 80)
  const origem = limpa(body.source, 80)

  try {
    // Lead NOVO = ainda não existe conversa de webchat para este visitante (o e-mail sai só uma vez)
    const jaExiste = await prisma.conversation.findFirst({ where: { channel: 'webchat', contact: { phone: visitorId } }, select: { id: true } })
    const inicio = new Date(Date.now() - 1000)

    const result = await ingestMessage({
      channel: 'webchat',
      externalId: visitorId,
      text,
      name: nome,
    })

    // Guarda os dados extras no contato/lead (contact.phone fica com o visitorId: é a chave do chat)
    if (telefone || email || cidade || origem) {
      const conv = await prisma.conversation.findFirst({
        where: { channel: 'webchat', contact: { phone: visitorId } }, orderBy: { lastMessageAt: 'desc' },
        select: { contactId: true, leadId: true },
      })
      if (conv?.contactId && email) await prisma.contact.update({ where: { id: conv.contactId }, data: { email } }).catch(() => {})
      if (conv?.leadId) {
        const ld = await prisma.lead.findUnique({ where: { id: conv.leadId }, select: { customFields: true } })
        const cf = (ld?.customFields as Record<string, unknown> | null) ?? {}
        await prisma.lead.update({ where: { id: conv.leadId }, data: { customFields: {
          ...cf,
          ...(telefone ? { telefone } : {}),
          ...(email ? { email } : {}),
          ...(cidade ? { city: cidade } : {}),
          ...(origem ? { origem } : {}),
        } as object } }).catch(() => {})
      }
    }

    // 📧 E-mail de lead novo para a Kerosolar (não bloqueia a resposta do chat)
    if (!jaExiste) {
      const conv = await prisma.conversation.findFirst({ where: { channel: 'webchat', contact: { phone: visitorId } }, select: { leadId: true } })
      const { notificarLeadPorEmail } = await import('@/lib/crm/lead-email')
      notificarLeadPorEmail({ nome, telefone, email, cidade, mensagem: text, origem: origem || 'Site (chat)', leadId: conv?.leadId ?? null }).catch(() => {})
    }

    // 2ª mensagem combinada pelo motor (ex.: fora do horário: "quer continuar agora ou amanhã?")
    if (result.followUp) {
      const { dispatchOutbound } = await import('@/lib/crm/flow')
      await dispatchOutbound(result.conversationId, result.followUp, undefined, 'ai').catch(() => {})
    }

    // 💬 O widget do site só mostra o "reply" desta resposta. Boa parte das respostas da IA sai por
    //    dispatchOutbound (pergunta de fora do horário, simulações, orçamento...) e volta reply=null —
    //    então devolvemos TODAS as mensagens enviadas a este visitante durante este processamento.
    let reply = result.reply ?? null
    let lastAt: string | null = null   // o widget busca (GET ?after=) só o que vier DEPOIS disto
    const convAtual = await prisma.conversation.findFirst({ where: { channel: 'webchat', contact: { phone: visitorId } }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } })
    if (convAtual) {
      const enviadas = await prisma.message.findMany({
        where: { conversationId: convAtual.id, direction: 'outbound', createdAt: { gte: inicio } },
        orderBy: { createdAt: 'asc' }, select: { content: true, createdAt: true },
      })
      const textos = enviadas.map((m) => (m.content ?? '').trim()).filter(Boolean)
      if (textos.length) reply = textos.join('\n\n')
      const ultima = await prisma.message.findFirst({ where: { conversationId: convAtual.id, direction: 'outbound' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      lastAt = (ultima?.createdAt ?? new Date()).toISOString()
    }

    return cors(NextResponse.json({ reply, handoff: result.handoff, lastAt }))
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
