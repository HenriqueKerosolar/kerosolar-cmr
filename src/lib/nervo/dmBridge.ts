// Ponte das mensagens diretas da Meta (Messenger / Instagram Direct) com o Mind Marketing, via Nervo.
// Decisão do dono (14/11/2026): UMA conexão só com a Meta — a do Marketing. O CRM recebe as DMs pelo
// evento `social.message.received`, atende igual ao WhatsApp (IA ou humano pelo Inbox) e devolve cada
// resposta como `social.message.send`; o Marketing entrega e confirma com `social.message.sent`.
//
// Onde fica o "endereço" da conversa: em `Contact.customFields.metaBridge` ({ clientAccountId, pageId, channel }),
// gravado ANTES de chamar o motor — assim qualquer resposta (IA, follow-up, humano) sabe por onde voltar.
// Cada resposta usa o id da própria `Message` do CRM como `requestId` (único, e é como achamos a mensagem
// quando chega o `social.message.sent`).
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { SocialMessageReceived, SocialMessageSent } from './socialMessages'
import { motivoFalhaEnvio } from './socialMessages'

export type MetaBridge = { clientAccountId: string; pageId: string; channel: 'facebook' | 'instagram' }

/** Marca de "pedido enviado ao Marketing, aguardando confirmação" no `Message.externalId`. */
export const PEDIDO_PENDENTE_PREFIX = 'nervo-req:'

export function lerMetaBridge(customFields: unknown): MetaBridge | null {
  const mb = (customFields as Record<string, unknown> | null)?.metaBridge as Partial<MetaBridge> | undefined
  if (!mb?.clientAccountId || !mb.pageId || (mb.channel !== 'facebook' && mb.channel !== 'instagram')) return null
  return { clientAccountId: mb.clientAccountId, pageId: mb.pageId, channel: mb.channel }
}

/** Baixa a primeira imagem anexada (ex.: foto da conta de luz) para a IA ler. Melhor esforço. */
async function baixarImagem(attachments: SocialMessageReceived['attachments']): Promise<{ base64: string; mime: string } | null> {
  const img = attachments?.find((a) => /image|photo|imagem/i.test(a.type))
  if (!img) return null
  try {
    const res = await fetch(img.url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]
    if (!/^image\//.test(mime)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}

/** `social.message.received` → Inbox + atendimento (igual ao WhatsApp). Idempotente por `externalId`. */
export async function processarDmRecebida(input: SocialMessageReceived): Promise<void> {
  // Reentrega do Mind: o motor também ignora mensagem com o mesmo externalId, mas evitamos até baixar anexo.
  const ja = await prisma.message.findFirst({ where: { direction: 'inbound', externalId: input.externalId }, select: { id: true } })
  if (ja) return

  // 1) Grava ANTES de atender por onde a resposta deve voltar (página + conta do Marketing).
  const campo = input.channel === 'facebook' ? 'facebookId' : 'instagramId'
  const bridge: MetaBridge = { clientAccountId: input.clientAccountId, pageId: input.pageId, channel: input.channel }
  const existente = await prisma.contact.findFirst({ where: { [campo]: input.senderId }, select: { id: true, customFields: true, name: true } })
  if (existente) {
    const cf = (existente.customFields as Record<string, unknown> | null) ?? {}
    await prisma.contact.update({
      where: { id: existente.id },
      data: { customFields: { ...cf, metaBridge: bridge } as object, ...(!existente.name && input.senderName ? { name: input.senderName } : {}) },
    })
  } else {
    await prisma.contact.create({ data: { [campo]: input.senderId, name: input.senderName ?? null, customFields: { metaBridge: bridge } as object } })
  }

  // 2) Atende pelo mesmo motor do WhatsApp.
  const imagem = await baixarImagem(input.attachments)
  const outrosAnexos = (input.attachments ?? []).filter((a) => !/image|photo|imagem/i.test(a.type))
  const displayText = input.text.trim()
    || (imagem ? '📷 Foto enviada' : outrosAnexos.length ? `📎 ${outrosAnexos[0].type} enviado` : '')
  const inicio = new Date(Date.now() - 1000)
  const { ingestMessage } = await import('@/lib/crm/engine')
  const result = await ingestMessage({
    channel: input.channel,
    externalId: input.senderId,
    text: input.text.trim(),
    displayText,
    name: input.senderName ?? null,
    externalMessageId: input.externalId,
    sentAt: Number.isNaN(Date.parse(input.sentAt)) ? null : new Date(input.sentAt),
    ...(imagem ? { imageBase64: imagem.base64, imageMediaType: imagem.mime } : {}),
  })

  // 3) A resposta "final" do motor é gravada no banco mas NÃO enviada por ele (no WhatsApp quem envia é o
  //    webhook). Aqui mandamos pela ponte toda resposta desta rodada que ainda não saiu.
  const pendentes = await prisma.message.findMany({
    where: { conversationId: result.conversationId, direction: 'outbound', createdAt: { gte: inicio }, externalId: null, failedReason: null },
    orderBy: { createdAt: 'asc' }, select: { id: true, content: true, mediaUrl: true },
  })
  for (const m of pendentes) {
    if (m.content?.trim() && !m.mediaUrl) await enviarDmPelaPonte(result.conversationId, m.id, m.content, input.externalId)
  }
  // 2ª mensagem combinada pelo motor (ex.: fora do horário) — sai depois da resposta.
  if (result.followUp) {
    const { dispatchOutbound } = await import('@/lib/crm/flow')
    await dispatchOutbound(result.conversationId, result.followUp, undefined, 'ai').catch(() => {})
  }
}

/**
 * Envia UMA mensagem do CRM (já gravada, id = `messageId`) pelo Marketing. Devolve `false` quando a conversa não
 * é da ponte (aí o chamador segue o caminho antigo). Nunca lança; falha fica visível no Inbox (`failedReason`).
 */
export async function enviarDmPelaPonte(conversationId: string, messageId: string, text: string, replyToExternalId?: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channel: true, contact: { select: { customFields: true, facebookId: true, instagramId: true } } } })
  if (!conv || (conv.channel !== 'facebook' && conv.channel !== 'instagram')) return false
  const bridge = lerMetaBridge(conv.contact?.customFields)
  if (!bridge) return false
  const recipientId = conv.channel === 'facebook' ? conv.contact?.facebookId : conv.contact?.instagramId
  const falhar = (motivo: string) => prisma.message.update({ where: { id: messageId }, data: { failedReason: motivo } }).catch(() => {})
  if (!recipientId) { await falhar('Não entregue: cliente sem identificação da Meta.'); return true }

  // Regra da Meta: fora da janela de 24h (contada da última mensagem do cliente) a resposta comum é recusada.
  const { janelaAberta } = await import('@/lib/crm/flow')
  if (!(await janelaAberta(conversationId))) { await falhar('Não entregue: a janela de 24h da Meta fechou (o cliente precisa escrever de novo).'); return true }

  const { getCrmNervo } = await import('./fromEnv')
  const nervo = getCrmNervo()
  if (!nervo) { await falhar('Não entregue: o CRM não está conectado ao Mind (Nervo desligado).'); return true }

  await prisma.message.update({ where: { id: messageId }, data: { externalId: `${PEDIDO_PENDENTE_PREFIX}${messageId}` } }).catch(() => {})
  const r = await nervo.publishSocialMessageSend({
    clientAccountId: bridge.clientAccountId, channel: bridge.channel, pageId: bridge.pageId, recipientId,
    text, requestId: messageId, ...(replyToExternalId ? { replyToExternalId } : {}),
  })
  if (r === 'unpaired') await falhar('Não entregue: o CRM ainda não está conectado ao Mind (aceite o pareamento no painel do Mind).')
  else if (r === 'error') await falhar('Não entregue: falha ao enviar para o Mind Marketing (tentaremos de novo no próximo envio).')
  return true
}

/** `social.message.sent` → marca entregue (externalId = mid da Meta) ou falha visível no Inbox. Idempotente. */
export async function marcarResultadoEnvio(result: SocialMessageSent): Promise<void> {
  const msg = await prisma.message.findUnique({ where: { id: result.requestId }, select: { id: true } })
  if (!msg) return // mensagem apagada (lead apagado): nada a marcar
  if (result.ok) {
    await prisma.message.update({ where: { id: msg.id }, data: { externalId: result.externalId ?? `${PEDIDO_PENDENTE_PREFIX}${msg.id}:ok`, failedReason: null, deliveredAt: new Date() } })
  } else {
    await prisma.message.update({ where: { id: msg.id }, data: { failedReason: motivoFalhaEnvio(result.error) } })
  }
}
