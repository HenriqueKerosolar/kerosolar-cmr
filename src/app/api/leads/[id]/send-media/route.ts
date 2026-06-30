import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

const MAX_BYTES = 25 * 1024 * 1024
const GRAPH = 'https://graph.facebook.com/v23.0'

type Kind = 'image' | 'audio' | 'video' | 'document'
function kindFromMime(mime: string): Kind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id: leadId } = await params

  const form = await req.formData()
  const file = form.get('file') as File | null
  const caption = ((form.get('caption') as string) || '').trim()
  if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx. 25 MB).' }, { status: 400 })

  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' }, include: { contact: true } })
  if (!conv) return NextResponse.json({ error: 'Esse lead ainda não tem conversa.' }, { status: 400 })

  const account = conv.accountId ? await prisma.whatsappAccount.findUnique({ where: { id: conv.accountId } }) : null
  if (!account?.cloudPhoneNumberId || !process.env.WHATSAPP_CLOUD_TOKEN) {
    return NextResponse.json({ error: 'WhatsApp Cloud não configurado.' }, { status: 503 })
  }

  const mime = file.type || 'application/octet-stream'
  const kind = kindFromMime(mime)

  try {
    // 📤 PASSO 1: Upload pra Meta (recebe mediaId)
    const up = new FormData()
    up.append('messaging_product', 'whatsapp')
    up.append('type', mime)
    up.append('file', file)

    const upRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` },
      body: up,
    })
    const upData = (await upRes.json()) as { id?: string; error?: { message?: string } }
    if (!upRes.ok || !upData.id) {
      return NextResponse.json({ error: upData.error?.message || 'Falha no upload da mídia.' }, { status: 502 })
    }

    // 📨 PASSO 2: Envia a mensagem com o mediaId
    const toPhone = conv.contact?.phone || conv.externalId || ''
    const mediaObj: Record<string, unknown> = { id: upData.id }
    if (caption && (kind === 'image' || kind === 'video' || kind === 'document')) mediaObj.caption = caption
    if (kind === 'document') mediaObj.filename = file.name

    const labels: Record<Kind, string> = { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📎 Arquivo' }
    const sendRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone.replace(/^\+/, ''),
        type: kind,
        [kind]: mediaObj,
      }),
    })
    const sendData = (await sendRes.json()) as { messages?: { id: string }[]; error?: { message?: string } }
    if (!sendRes.ok) {
      return NextResponse.json({ error: sendData.error?.message || 'Falha ao enviar a mídia.' }, { status: 502 })
    }
    const waId = sendData.messages?.[0]?.id

    // 💾 Grava no histórico
    const createdMsg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        senderType: 'human',
        senderUserId: session.userId,
        content: caption || labels[kind],
        mediaUrl: `${GRAPH}/${upData.id}`,
        mediaType: kind,
      },
    })
    if (waId) await prisma.message.update({ where: { id: createdMsg.id }, data: { externalId: waId } }).catch(() => {})
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } })
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[send-media] ERRO:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao enviar o arquivo.' }, { status: 500 })
  }
}
