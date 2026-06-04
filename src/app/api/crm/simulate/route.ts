import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { ingestMessage } from '@/lib/crm/engine'
import { prisma } from '@/lib/prisma'
import type { Channel } from '@prisma/client'

const CHANNELS: Channel[] = ['whatsapp', 'instagram', 'facebook', 'simulator']

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await req.json()
  const text      = typeof body.text      === 'string' ? body.text.trim().slice(0, 2000) : ''
  const channel   = CHANNELS.includes(body.channel) ? body.channel as Channel : 'simulator'
  const externalId = body.externalId || `sim-${session.userId}`
  const name      = body.name || null

  if (!text) return NextResponse.json({ error: 'Escreva uma mensagem.' }, { status: 400 })

  try {
    const result = await ingestMessage({ channel, externalId, text, name })
    const [lead, messages] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: result.leadId },
        include: {
          stage: true,
          pipeline: { include: { stages: { orderBy: { sortOrder: 'asc' } } } },
          contact: true,
          tasks: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' } },
          notes: { orderBy: { createdAt: 'asc' } },
        },
      }),
      prisma.message.findMany({
        where: { conversationId: result.conversationId },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ result, lead, messages })
  } catch (err) {
    console.error('[simulate]', err)
    return NextResponse.json({ error: 'Erro ao processar.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const externalId = new URL(req.url).searchParams.get('externalId') || `sim-${session.userId}`
  try {
    const contacts = await prisma.contact.findMany({
      where: { OR: [{ whatsappId: externalId }, { instagramId: externalId }, { facebookId: externalId }, { phone: externalId }] },
      select: { id: true },
    })
    const ids = contacts.map((c) => c.id)
    if (!ids.length) return NextResponse.json({ ok: true, deleted: 0 })
    await prisma.$transaction([
      prisma.conversation.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.lead.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.contact.deleteMany({ where: { id: { in: ids } } }),
    ])
    return NextResponse.json({ ok: true, deleted: ids.length })
  } catch (err) {
    console.error('[simulate DELETE]', err)
    return NextResponse.json({ error: 'Falha ao resetar.' }, { status: 500 })
  }
}
