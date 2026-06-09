import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { ingestMessage } from '@/lib/crm/engine'
import { loadAiConfig, transcribeAudio } from '@/lib/crm/ai'
import { parseBillText, isBillPdf } from '@/lib/crm/pdf-utils'
import { prisma } from '@/lib/prisma'
import type { Channel } from '@prisma/client'

const CHANNELS: Channel[] = ['whatsapp', 'instagram', 'facebook', 'simulator']

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let text = '', channel: Channel = 'simulator', externalId = `sim-${session.userId}`, name: string | null = null
  let imageBase64: string | undefined, imageMediaType: string | undefined
  let displayText: string | undefined

  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    text        = (form.get('text') as string ?? '').trim().slice(0, 2000)
    channel     = CHANNELS.includes(form.get('channel') as Channel) ? form.get('channel') as Channel : 'simulator'
    externalId  = (form.get('externalId') as string) || `sim-${session.userId}`
    name        = (form.get('name') as string) || null
    const file  = form.get('image') as File | null
    if (file) {
      const buf = Buffer.from(await file.arrayBuffer())
      const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')
      if (isPdf) {
        // unpdf (serverless) — pdftotext NÃO existe no Railway
        let pdfText = ''
        try {
          const { extractText, getDocumentProxy } = await import('unpdf')
          const pdf = await getDocumentProxy(new Uint8Array(buf))
          const { text: pdfRaw } = await extractText(pdf, { mergePages: true })
          pdfText = (Array.isArray(pdfRaw) ? pdfRaw.join('\n') : pdfRaw ?? '').trim().slice(0, 3000)
        } catch (e) { console.error('[simulate pdf]', e) }
        if (pdfText) {
          const summary = parseBillText(pdfText)
          const isBill = isBillPdf(summary)
          if (isBill) {
            // SÓ o resumo estruturado — NÃO incluir o texto bruto (código de barras /
            // linha digitável confundem a extração e geram valores absurdos).
            text = `Segue minha conta de luz (PDF):\n\n${summary}\n\nIMPORTANTE: use o consumo em kWh para o cálculo do sistema.`
            displayText = '📄 Conta de luz enviada (PDF)'
          } else {
            // Outro documento (cotação, proposta, etc.) → IA lê e responde dúvidas
            text = `Segue um documento PDF. Leia o conteúdo abaixo e responda qualquer dúvida sobre ele:\n\n${pdfText.slice(0, 3000)}`
            displayText = '📄 Documento enviado (PDF)'
          }
        } else {
          text = 'Enviei um PDF mas não consegui abrir. Pode me orientar?'
          displayText = '📄 Documento enviado (PDF)'
        }
      } else {
        // Imagem → visão da IA
        imageBase64    = buf.toString('base64')
        imageMediaType = file.type || 'image/jpeg'
        text           = text || 'Segue a foto da minha conta de luz.'
        displayText    = '📷 Foto da conta de luz enviada'
      }
    }

    // Áudio → transcrição via OpenAI Whisper
    const audioFile = form.get('audio') as File | null
    if (audioFile) {
      const buf = Buffer.from(await audioFile.arrayBuffer())
      const cfg = await loadAiConfig()
      const transcript = await transcribeAudio(cfg, buf, audioFile.type || 'audio/ogg')
      if (transcript) {
        text        = transcript
        displayText = `🎤 "${transcript}"`
      } else {
        text        = 'Enviei um áudio.'
        displayText = '🎤 Áudio enviado'
      }
    }
  } else {
    const body  = await req.json()
    text        = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
    channel     = CHANNELS.includes(body.channel) ? body.channel as Channel : 'simulator'
    externalId  = body.externalId || `sim-${session.userId}`
    name        = body.name || null
  }

  if (!text && !imageBase64) return NextResponse.json({ error: 'Escreva uma mensagem ou envie uma imagem.' }, { status: 400 })

  try {
    const result = await ingestMessage({ channel, externalId, text, displayText, name, imageBase64, imageMediaType })
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

export async function GET(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const externalId = new URL(req.url).searchParams.get('externalId') || `sim-${session.userId}`

  const contact = await prisma.contact.findFirst({
    where: { OR: [{ phone: externalId }, { whatsappId: externalId }, { instagramId: externalId }, { facebookId: externalId }] },
  })
  if (!contact) return NextResponse.json({ messages: [], lead: null })

  const lead = await prisma.lead.findFirst({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { sortOrder: 'asc' } } } },
      contact: true,
      tasks: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' } },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!lead) return NextResponse.json({ messages: [], lead: null })

  const conv = await prisma.conversation.findFirst({
    where: { leadId: lead.id }, orderBy: { lastMessageAt: 'desc' },
  })
  if (!conv) return NextResponse.json({ messages: [], lead })

  const messages = await prisma.message.findMany({
    where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ messages, lead })
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
