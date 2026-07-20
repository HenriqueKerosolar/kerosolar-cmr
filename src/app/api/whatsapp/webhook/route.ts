import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Webhook da API OFICIAL do WhatsApp (Meta Cloud API).
 * GET  → verificação do webhook (a Meta manda hub.challenge ao conectar).
 * POST → mensagens recebidas + recibos. Cada mensagem entra no MESMO motor (ingestMessage),
 *        então toda a lógica (IA, orçamento, etapas) funciona igual ao Baileys.
 */

// GET: a Meta valida o webhook batendo aqui com hub.verify_token.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode = sp.get('hub.mode')
  const token = sp.get('hub.verify_token')
  const challenge = sp.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('forbidden', { status: 403 })
}

// Valida a assinatura X-Hub-Signature-256 (HMAC com o App Secret). Se não houver secret, libera (modo teste).
function assinaturaValida(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return true
  if (!header) return false
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(header))
  } catch { return false }
}

type WaMessage = {
  from: string
  id: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  video?: { id: string; mime_type?: string; caption?: string }
  audio?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string; filename?: string; caption?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  // 🆕 CTWA: presente só na 1ª msg de quem clicou num anúncio clique-para-WhatsApp
  referral?: {
    ctwa_clid?: string
    source_id?: string      // ID do anúncio
    source_url?: string
    source_type?: string    // normalmente "ad"
    headline?: string
    body?: string
  }
  // Fallback: em respostas a mensagens de anúncio, o referral pode vir dentro de context
  context?: {
    referral?: {
      ctwa_clid?: string
      source_id?: string
      source_url?: string
      source_type?: string
      headline?: string
      body?: string
    }
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!assinaturaValida(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('invalid signature', { status: 401 })
  }

  let body: any
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  // Responde 200 rápido; processa em seguida. (A Meta reentrega se demorar/der erro.)
  try {
    for (const entry of body?.entry ?? []) {
      const wabaId = entry?.id as string | undefined
      for (const change of entry?.changes ?? []) {
        const value = change.value ?? {}
        // 🔎 LOG de diagnóstico: toda entrega da Meta (mensagens E status) aparece aqui.
        console.log('[wa cloud webhook] field=%s pnid=%s msgs=%d statuses=%d',
          change?.field, value?.metadata?.phone_number_id, value?.messages?.length || 0, value?.statuses?.length || 0)
        const phoneNumberId = value?.metadata?.phone_number_id as string | undefined

        // Recibos de entrega/leitura (statuses) → atualiza deliveredAt / readAt na mensagem
        if (change?.field === 'messages' && value?.statuses?.length) {
          for (const st of value.statuses as { id: string; status: string }[]) {
            if (!st.id) continue
            if (st.status === 'delivered') {
              await prisma.message.updateMany({
                where: { externalId: st.id, deliveredAt: null },
                data: { deliveredAt: new Date() },
              }).catch(() => {})
            } else if (st.status === 'read') {
              await prisma.message.updateMany({
                where: { externalId: st.id },
                data: { readAt: new Date(), deliveredAt: new Date() },
              }).catch(() => {})
            } else if (st.status === 'failed') {
              await prisma.message.updateMany({
                where: { externalId: st.id },
                data: { failedReason: 'meta_rejeitou' },
              }).catch(() => {})
            }
          }
        }

        if (change?.field !== 'messages') continue
        const msgs: WaMessage[] = value?.messages ?? []
        if (!phoneNumberId || !msgs.length) continue

        // Encontra (ou cria) a conta "cloud" deste número
        const account = await acharOuCriarConta(phoneNumberId, wabaId, value?.metadata?.display_phone_number)
        if (!account) continue

        const nomeContato = value?.contacts?.[0]?.profile?.name as string | undefined

        for (const m of msgs) {
          await processarMensagem(m, account, nomeContato)
        }
      }
    }
  } catch (e) {
    console.error('[wa cloud webhook] erro:', e)
  }

  return NextResponse.json({ ok: true })
}

async function acharOuCriarConta(phoneNumberId: string, wabaId?: string, displayPhone?: string) {
  let acc = await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: phoneNumberId } })
  if (!acc) {
    // Aceita QUALQUER phone_number_id que a Meta mandar (as contas duplicadas podem rotear por IDs
    // diferentes). Assim nenhuma mensagem é descartada — e a conta certa é criada na hora.
    acc = await prisma.whatsappAccount.create({
      data: {
        label: 'KeroSolar (Oficial)', provider: 'cloud', cloudPhoneNumberId: phoneNumberId,
        cloudWabaId: wabaId ?? null, status: 'connected', connectedAt: new Date(),
        phone: displayPhone ? displayPhone.replace(/\D/g, '') : null,
      },
    })
    console.log('[wa cloud webhook] conta cloud criada p/ phone_number_id', phoneNumberId)
  }
  return acc
}

async function processarMensagem(m: WaMessage, account: { id: string; cloudPhoneNumberId: string | null; cloudWabaId: string | null }, nome?: string) {
  const from = (m.from || '').replace(/\D/g, '')
  if (!from) return

  let text = ''
  let displayText: string | undefined
  let imageBase64: string | undefined
  let imageMediaType: string | undefined
  let mediaUrl: string | undefined
  let mediaType: 'image' | 'video' | 'document' | 'audio' | undefined

  if (m.type === 'text') {
    text = m.text?.body ?? ''
  } else if (m.type === 'button') {
    text = m.button?.text ?? ''
  } else if (m.type === 'interactive') {
    text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
  } else if (m.type === 'image' || m.type === 'video' || m.type === 'document' || m.type === 'audio') {
    const mediaObj = (m as any)[m.type] as { id: string; mime_type?: string; caption?: string; filename?: string }
    const { downloadCloudMedia } = await import('@/lib/crm/cloud-api')
    const dl = mediaObj?.id ? await downloadCloudMedia(mediaObj.id) : null
    const caption = mediaObj?.caption ?? ''
    if (m.type === 'image') {
      displayText = caption || '📷 Foto enviada'
      mediaType = 'image'
      if (dl) {
        imageBase64 = dl.buffer.toString('base64')
        imageMediaType = dl.mimeType
        const { salvarMidiaRecebida } = await import('@/lib/crm/whatsapp')
        mediaUrl = salvarMidiaRecebida(dl.buffer, '.' + (dl.mimeType.split('/')[1] || 'jpg')) ?? undefined
      }
      text = caption
    } else if (m.type === 'audio') {
      displayText = '🎤 Áudio'
      mediaType = 'audio'
      if (dl) {
        // Salva o áudio pra poder OUVIR no app
        const { salvarMidiaRecebida } = await import('@/lib/crm/whatsapp')
        const ext = '.' + ((dl.mimeType.split('/')[1] || 'ogg').split(';')[0])
        mediaUrl = salvarMidiaRecebida(dl.buffer, ext) ?? undefined
        // E transcreve (Whisper) pra ficar pesquisável/legível
        try {
          const { loadAiConfig, transcribeAudio } = await import('@/lib/crm/ai')
          const cfg = await loadAiConfig()
          const txt = await transcribeAudio(cfg, dl.buffer, dl.mimeType)
          if (txt) { text = txt; displayText = `🎤 ${txt}` }
        } catch { /* segue sem transcrição */ }
      }
    } else {
      // vídeo / documento → salva e registra
      displayText = m.type === 'video' ? '🎥 Vídeo enviado' : '📎 Documento enviado'
      mediaType = m.type
      if (dl) {
        const ext = m.type === 'video' ? '.mp4' : ('.' + ((mediaObj?.filename?.split('.').pop()) || (dl.mimeType.split('/')[1]) || 'bin'))
        const { salvarMidiaRecebida } = await import('@/lib/crm/whatsapp')
        mediaUrl = salvarMidiaRecebida(dl.buffer, ext) ?? undefined
      }
      text = caption
    }
  } else {
    return // tipos não tratados (location, contacts, reaction, etc.)
  }

  const { ingestMessage } = await import('@/lib/crm/engine')
  const result = await ingestMessage({
    channel: 'whatsapp',
    externalId: from,
    text,
    displayText,
    name: nome,
    phone: from,
    accountId: account.id,
    externalMessageId: m.id ?? null,
    imageBase64,
    imageMediaType,
    mediaUrl: mediaUrl ?? null,
    mediaType: mediaType ?? null,
  })

  // 🆕 CTWA: se a mensagem veio de um clique em anúncio, guarda o carimbo no contato
  // e avisa a Meta que o anúncio gerou uma conversa (sinal de topo de funil).
  // Fallback: alguns eventos trazem o referral dentro de context.referral.
  const ref = m.referral ?? m.context?.referral
  const clid = ref?.ctwa_clid
  if (clid) {
    await prisma.contact.updateMany({
      where: { OR: [{ phone: from }, { whatsappId: from }] },
      data: {
        ctwaClid: clid,
        ctwaClidAt: new Date(),
        adReferral: {
          source_id: ref?.source_id ?? null,
          source_url: ref?.source_url ?? null,
          source_type: ref?.source_type ?? null,
          headline: ref?.headline ?? null,
          body: ref?.body ?? null,
        } as unknown as object,
      },
    }).catch(() => {})

    const { sendCapiEvent } = await import('@/lib/crm/capi')
    void sendCapiEvent({
      eventName: 'Lead',                       // conversa iniciada por anúncio
      ctwaClid: clid,
      wabaId: account.cloudWabaId,
      phone: from,
      eventId: `${from}:lead:${m.id ?? ''}`,   // dedup
    }).catch(() => {})
  }

  // 📤 ENVIA a resposta da IA pela API oficial. O motor cria a mensagem no banco, mas QUEM ENVIA
  //    pro canal é o chamador (igual o Baileys faz com sendText). Sem isso, a IA "responde" só no
  //    banco e nada chega no WhatsApp.
  if (result?.reply && account.cloudPhoneNumberId) {
    const { sendCloudText } = await import('@/lib/crm/cloud-api')
    await sendCloudText(account.cloudPhoneNumberId, from, result.reply).catch((e) => console.error('[wa cloud send reply]', e))
  }
}
