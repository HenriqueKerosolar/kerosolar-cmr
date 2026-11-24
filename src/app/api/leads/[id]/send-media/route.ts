import { NextResponse } from 'next/server'
import path from 'path'
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

  // O navegador às vezes manda o arquivo SEM tipo (Windows sem leitor de PDF registrado) e a Meta recusa
  // "application/octet-stream" — descobre pelo nome (24/11/2026: ebook não saía).
  const POR_EXT: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
  }
  const extNome = path.extname(file.name || '').toLowerCase()
  const mime = (file.type && file.type !== 'application/octet-stream') ? file.type : (POR_EXT[extNome] || 'application/octet-stream')
  const falhou = (etapa: string, motivo: string) => {
    console.error('[send-media] falhou (%s) lead=%s arquivo="%s" tipo=%s tamanho=%d: %s', etapa, leadId, file.name, mime, file.size, motivo)
  }
  if (mime === 'application/octet-stream') {
    falhou('tipo', 'tipo de arquivo desconhecido')
    return NextResponse.json({ error: `O WhatsApp não aceita esse tipo de arquivo ("${file.name}"). Envie PDF, imagem, vídeo, áudio, Word, Excel ou PowerPoint.` }, { status: 400 })
  }
  const kind = kindFromMime(mime)

  // 📷 Instagram / Facebook (24/11/2026 — Livingstone): o arquivo ia pelo WhatsApp para um "número" que é o id do
  //    Instagram e a Meta recusava (131026). A ponte do Mind Marketing só leva TEXTO → guarda o arquivo e manda
  //    um LINK PÚBLICO ASSINADO (link-arquivo.ts, vale 30 dias) pelo mesmo canal da conversa.
  if (conv.channel === 'instagram' || conv.channel === 'facebook') {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx. 25 MB).' }, { status: 400 })
    const { salvarMidiaRecebida } = await import('@/lib/crm/media')
    const extIg = path.extname(file.name || '') || ('.' + ((mime.split('/')[1] || 'bin').split(';')[0]))
    const copia = salvarMidiaRecebida(Buffer.from(await file.arrayBuffer()), extIg)
    const { linkPublicoDoAnexo } = await import('@/lib/crm/link-arquivo')
    const link = copia ? linkPublicoDoAnexo(copia, file.name) : null
    if (!copia || !link) {
      console.error('[send-media] instagram/facebook: não consegui guardar o arquivo (lead=%s)', leadId)
      return NextResponse.json({ error: 'Não consegui guardar o arquivo para enviar. Tente de novo.' }, { status: 500 })
    }
    const nomeVisivel = file.name || 'arquivo'
    const texto = `${caption ? `${caption}\n\n` : ''}📎 ${nomeVisivel}\n${link}`
    const { dispatchOutbound } = await import('@/lib/crm/flow')
    // vai como TEXTO (ponte do Marketing); o anexo fica guardado no histórico do CRM para abrir aqui
    await dispatchOutbound(conv.id, texto, undefined, 'human', session.userId, true)
    const ultima = await prisma.message.findFirst({ where: { conversationId: conv.id, direction: 'outbound', content: texto }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (ultima) await prisma.message.update({ where: { id: ultima.id }, data: { mediaUrl: copia, mediaType: kind } }).catch(() => {})
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
    return NextResponse.json({ ok: true })
  }

  // Mesma regra do texto (dispatchOutbound): conversa sem conta, ou de conta antiga (Baileys), sai pela
  // primeira conta da API oficial. Antes o arquivo dava "WhatsApp Cloud não configurado" nesses leads.
  const daConversa = conv.accountId ? await prisma.whatsappAccount.findUnique({ where: { id: conv.accountId } }) : null
  const account = (daConversa?.provider === 'cloud' && daConversa.cloudPhoneNumberId)
    ? daConversa
    : await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
  if (!account?.cloudPhoneNumberId || !process.env.WHATSAPP_CLOUD_TOKEN) {
    console.error('[send-media] sem conta da API oficial (lead=%s, conversa=%s)', leadId, conv.id)
    return NextResponse.json({ error: 'WhatsApp Cloud não configurado.' }, { status: 503 })
  }


  try {
    // 📤 PASSO 1: Upload pra Meta (recebe mediaId)
    const up = new FormData()
    up.append('messaging_product', 'whatsapp')
    up.append('type', mime)
    up.append('file', new Blob([await file.arrayBuffer()], { type: mime }), file.name || `arquivo${extNome}`)

    const upRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` },
      body: up,
    })
    const upData = (await upRes.json()) as { id?: string; error?: { message?: string } }
    if (!upRes.ok || !upData.id) {
      falhou('upload Meta', JSON.stringify(upData.error ?? upData).slice(0, 300))
      return NextResponse.json({ error: upData.error?.message || 'Falha no upload da mídia.' }, { status: 502 })
    }

    // 📨 PASSO 2: Envia a mensagem com o mediaId
    const toPhone = conv.contact?.whatsappId || conv.contact?.phone || conv.externalId || ''
    if (!toPhone) {
      falhou('destino', 'contato sem número de WhatsApp')
      return NextResponse.json({ error: 'Esse contato não tem número de WhatsApp.' }, { status: 400 })
    }
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
      falhou('envio Meta', JSON.stringify(sendData.error ?? sendData).slice(0, 300))
      return NextResponse.json({ error: sendData.error?.message || 'Falha ao enviar a mídia.' }, { status: 502 })
    }
    const waId = sendData.messages?.[0]?.id

    // 💾 Cópia do arquivo no CRM (16/11/2026): antes ficava só o endereço interno da Meta
    //    (graph.facebook.com/<id>), que o navegador não abre — o PDF enviado não abria no CRM.
    const { salvarMidiaRecebida } = await import('@/lib/crm/media')
    const ext = path.extname(file.name || '') || ('.' + ((mime.split('/')[1] || 'bin').split(';')[0]))
    const copiaLocal = salvarMidiaRecebida(Buffer.from(await file.arrayBuffer()), ext)

    // 💾 Grava no histórico
    const createdMsg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        senderType: 'human',
        senderUserId: session.userId,
        content: caption || labels[kind],
        mediaUrl: copiaLocal ?? `${GRAPH}/${upData.id}`,
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
