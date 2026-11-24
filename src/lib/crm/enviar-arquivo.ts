import 'server-only'
// 📎 Envia UM arquivo ao cliente pelo canal da conversa e grava a mensagem no histórico.
// Extraído de src/app/api/leads/[id]/send-media/route.ts (24/11/2026) para o "envia orçamento" usar o MESMO caminho:
//   • Instagram/Facebook → ponte do Mind Marketing (enviarDmPelaPonte com anexo; link público assinado);
//   • WhatsApp → upload na API oficial (Cloud) + envio com o mediaId (conta da conversa, ou a 1ª conta Cloud).
import path from 'path'
import { prisma } from '@/lib/prisma'

const GRAPH = 'https://graph.facebook.com/v23.0'

export type TipoArquivo = 'image' | 'audio' | 'video' | 'document'
export function tipoPeloMime(mime: string): TipoArquivo {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

type ConversaComContato = {
  id: string; channel: string; accountId: string | null; externalId: string | null
  contact: { whatsappId: string | null; phone: string | null } | null
}

export type EnvioArquivo = {
  leadId: string
  conv: ConversaComContato
  userId?: string | null
  buffer: Buffer
  nome: string          // nome do arquivo que o cliente vê
  mime: string
  caption?: string
  /** Arquivo já guardado no CRM (/api/uploads/...) — reaproveita em vez de gravar outra cópia. */
  copiaLocal?: string | null
}

export type ResultadoEnvioArquivo = { ok: true; messageId: string } | { ok: false; erro: string; status: number }

export async function enviarArquivoNaConversa(a: EnvioArquivo): Promise<ResultadoEnvioArquivo> {
  const { leadId, conv, buffer, nome, mime } = a
  const caption = (a.caption ?? '').trim()
  const kind = tipoPeloMime(mime)
  const ext = path.extname(nome || '') || ('.' + ((mime.split('/')[1] || 'bin').split(';')[0]))
  const falhou = (etapa: string, motivo: string) => {
    console.error('[send-media] falhou (%s) lead=%s arquivo="%s" tipo=%s tamanho=%d: %s', etapa, leadId, nome, mime, buffer.length, motivo)
  }
  const guardar = async () => {
    if (a.copiaLocal) return a.copiaLocal
    const { salvarMidiaRecebida } = await import('@/lib/crm/media')
    return salvarMidiaRecebida(buffer, ext)
  }

  // 📷 Instagram / Facebook (24/11/2026 — Livingstone): o arquivo ia pelo WhatsApp para um "número" que é o id do
  //    Instagram e a Meta recusava (131026). Guarda o arquivo e manda pela ponte do Mind Marketing (anexo de verdade).
  if (conv.channel === 'instagram' || conv.channel === 'facebook') {
    const copia = await guardar()
    const { linkPublicoDoAnexo } = await import('@/lib/crm/link-arquivo')
    const link = copia ? linkPublicoDoAnexo(copia, nome) : null
    if (!copia || !link) {
      console.error('[send-media] instagram/facebook: não consegui guardar o arquivo (lead=%s)', leadId)
      return { ok: false, erro: 'Não consegui guardar o arquivo para enviar. Tente de novo.', status: 500 }
    }
    const nomeVisivel = nome || 'arquivo'
    const labelsIg: Record<TipoArquivo, string> = { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: `📎 ${nomeVisivel}` }
    const msg = await prisma.message.create({
      data: { conversationId: conv.id, direction: 'outbound', senderType: 'human', senderUserId: a.userId ?? null, content: caption || labelsIg[kind], mediaUrl: copia, mediaType: kind },
    })
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } })
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
    // ANEXO de verdade pela ponte do Mind Marketing (social.message.send com `attachment`). Se a Meta recusar o tipo
    // no canal, o Marketing manda o link. Resultado (entregue/falha) volta no social.message.sent.
    const { enviarDmPelaPonte } = await import('@/lib/nervo/dmBridge')
    const viaPonte = await enviarDmPelaPonte(conv.id, msg.id, caption, undefined, { url: copia, type: kind, name: nomeVisivel })
    if (!viaPonte) {
      // conversa antiga sem a ponte: manda o link como texto pelo caminho antigo
      const { dispatchOutbound } = await import('@/lib/crm/flow')
      await dispatchOutbound(conv.id, `${caption ? `${caption}\n\n` : ''}📎 ${nomeVisivel}\n${link}`, undefined, 'human', a.userId ?? undefined, true)
    }
    return { ok: true, messageId: msg.id }
  }

  // Mesma regra do texto (dispatchOutbound): conversa sem conta, ou de conta antiga (Baileys), sai pela
  // primeira conta da API oficial.
  const daConversa = conv.accountId ? await prisma.whatsappAccount.findUnique({ where: { id: conv.accountId } }) : null
  const account = (daConversa?.provider === 'cloud' && daConversa.cloudPhoneNumberId)
    ? daConversa
    : await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
  if (!account?.cloudPhoneNumberId || !process.env.WHATSAPP_CLOUD_TOKEN) {
    console.error('[send-media] sem conta da API oficial (lead=%s, conversa=%s)', leadId, conv.id)
    return { ok: false, erro: 'WhatsApp Cloud não configurado.', status: 503 }
  }

  // 📤 PASSO 1: Upload pra Meta (recebe mediaId)
  const up = new FormData()
  up.append('messaging_product', 'whatsapp')
  up.append('type', mime)
  up.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), nome || `arquivo${ext}`)
  const upRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` }, body: up,
  })
  const upData = (await upRes.json()) as { id?: string; error?: { message?: string } }
  if (!upRes.ok || !upData.id) {
    falhou('upload Meta', JSON.stringify(upData.error ?? upData).slice(0, 300))
    return { ok: false, erro: upData.error?.message || 'Falha no upload da mídia.', status: 502 }
  }

  // 📨 PASSO 2: Envia a mensagem com o mediaId
  const toPhone = conv.contact?.whatsappId || conv.contact?.phone || conv.externalId || ''
  if (!toPhone) {
    falhou('destino', 'contato sem número de WhatsApp')
    return { ok: false, erro: 'Esse contato não tem número de WhatsApp.', status: 400 }
  }
  const mediaObj: Record<string, unknown> = { id: upData.id }
  if (caption && (kind === 'image' || kind === 'video' || kind === 'document')) mediaObj.caption = caption
  if (kind === 'document') mediaObj.filename = nome
  const labels: Record<TipoArquivo, string> = { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📎 Arquivo' }
  const sendRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: toPhone.replace(/^\+/, ''), type: kind, [kind]: mediaObj }),
  })
  const sendData = (await sendRes.json()) as { messages?: { id: string }[]; error?: { message?: string } }
  if (!sendRes.ok) {
    falhou('envio Meta', JSON.stringify(sendData.error ?? sendData).slice(0, 300))
    return { ok: false, erro: sendData.error?.message || 'Falha ao enviar a mídia.', status: 502 }
  }
  const waId = sendData.messages?.[0]?.id

  // 💾 Cópia do arquivo no CRM (16/11/2026): antes ficava só o endereço interno da Meta (graph.facebook.com/<id>),
  //    que o navegador não abre — o PDF enviado não abria no CRM.
  const copiaLocal = await guardar()
  const createdMsg = await prisma.message.create({
    data: {
      conversationId: conv.id, direction: 'outbound', senderType: 'human', senderUserId: a.userId ?? null,
      content: caption || labels[kind], mediaUrl: copiaLocal ?? `${GRAPH}/${upData.id}`, mediaType: kind,
    },
  })
  if (waId) await prisma.message.update({ where: { id: createdMsg.id }, data: { externalId: waId } }).catch(() => {})
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } })
  await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
  return { ok: true, messageId: createdMsg.id }
}
