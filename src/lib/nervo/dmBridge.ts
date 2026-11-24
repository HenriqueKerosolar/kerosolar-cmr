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

type AnexoGuardado = { url: string; tipo: 'image' | 'video' | 'audio' | 'document'; mime: string; buf: Buffer; compartilhado: boolean }

/** Post/reel/story COMPARTILHADO no Direct (tipo "ig_post", "share", "reel"…): normalmente o anúncio que o cliente viu.
 *  Não é arquivo nem conta de luz — a IA não lê como conta. */
const ehCompartilhamento = (tipo: string) => /ig_post|ig_reel|reel|share|story|template|fallback/i.test(tipo || '')

/** 24/11/2026: guarda no CRM os anexos que o cliente mandou pelo Instagram/Facebook (o link da Meta vence) para
 *  abrir no chat. Melhor esforço: o que falhar fica só no texto "📎 ... enviado". */
async function guardarAnexos(attachments: SocialMessageReceived['attachments']): Promise<AnexoGuardado[]> {
  const out: AnexoGuardado[] = []
  const { salvarMidiaRecebida } = await import('@/lib/crm/media')
  for (const a of (attachments ?? []).slice(0, 5)) {
    try {
      const res = await fetch(a.url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const mime = (res.headers.get('content-type') || '').split(';')[0].toLowerCase()
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length || buf.length > 25 * 1024 * 1024) continue
      const tipo: AnexoGuardado['tipo'] = /^image\//.test(mime) || /image|photo/i.test(a.type) ? 'image'
        : /^video\//.test(mime) || /video/i.test(a.type) ? 'video'
        : /^audio\//.test(mime) || /audio/i.test(a.type) ? 'audio' : 'document'
      const ext = mime === 'application/pdf' ? '.pdf' : mime.includes('jpeg') ? '.jpg' : mime.includes('png') ? '.png'
        : mime.includes('webp') ? '.webp' : mime.includes('mp4') ? '.mp4' : mime.includes('mpeg') ? '.mp3'
        : mime.includes('ogg') ? '.ogg' : mime.includes('aac') ? '.aac' : mime.includes('gif') ? '.gif'
        : ('.' + ((new URL(a.url).pathname.split('.').pop() || 'bin').slice(0, 5)))
      const url = salvarMidiaRecebida(buf, ext)
      if (url) out.push({ url, tipo, mime, buf, compartilhado: ehCompartilhamento(a.type) })
    } catch { /* segue */ }
  }
  return out
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
  // Anúncio de origem (clique no anúncio → DM): guardado no mesmo campo do CTWA do WhatsApp (`adReferral.source_id`),
  // para o desfecho do lead (lead.won/lost) levar o `sourceAdId` ao painel do Marketing.
  const anuncio = input.referral?.adId
    ? { adReferral: { source_id: input.referral.adId, source: input.referral.source ?? null, ref: input.referral.ref ?? null, channel: input.channel, capturedAt: new Date().toISOString() } as object }
    : {}
  if (existente) {
    const cf = (existente.customFields as Record<string, unknown> | null) ?? {}
    await prisma.contact.update({
      where: { id: existente.id },
      data: { customFields: { ...cf, metaBridge: bridge } as object, ...anuncio, ...(!existente.name && input.senderName ? { name: input.senderName } : {}) },
    })
  } else {
    await prisma.contact.create({ data: { [campo]: input.senderId, name: input.senderName ?? null, customFields: { metaBridge: bridge } as object, ...anuncio } })
  }

  // 2) Atende pelo mesmo motor do WhatsApp.
  const guardados = await guardarAnexos(input.attachments)
  const principal = guardados[0]
  // imagem → a IA lê (conta de luz); PDF → a IA também lê (bloco de documento)
  const paraIA = principal && !principal.compartilhado ? principal : undefined
  const soCompartilhou = (input.attachments ?? []).length > 0 && (input.attachments ?? []).every((a) => ehCompartilhamento(a.type))
  const imagem = paraIA?.tipo === 'image' && paraIA.buf.length <= 8 * 1024 * 1024
    ? { base64: paraIA.buf.toString('base64'), mime: paraIA.mime || 'image/jpeg' }
    : (guardados.length || soCompartilhou ? null : await baixarImagem(input.attachments))
  const pdf = paraIA?.mime === 'application/pdf' && paraIA.buf.length <= 8 * 1024 * 1024 ? paraIA.buf.toString('base64') : null
  const outrosAnexos = (input.attachments ?? []).filter((a) => !/image|photo|imagem/i.test(a.type))
  const rotulo: Record<AnexoGuardado['tipo'], string> = { image: '📷 Foto enviada', video: '🎬 Vídeo enviado', audio: '🎤 Áudio enviado', document: '📎 Arquivo enviado' }
  const COMPARTILHOU = '🔗 Compartilhou uma publicação do Instagram/Facebook (provavelmente o anúncio que viu)'
  const displayText = input.text.trim()
    || (soCompartilhou ? COMPARTILHOU
      : principal ? rotulo[principal.tipo] : imagem ? '📷 Foto enviada' : outrosAnexos.length ? `📎 ${outrosAnexos[0].type} enviado` : '')
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
    ...(pdf ? { pdfBase64: pdf } : {}),
    ...(principal ? { mediaUrl: principal.url, mediaType: principal.tipo } : {}),
    permitirBelenus: true,   // segue em segundo plano depois do ack ao Mind (socialMessages.ts)
  })
  // anexos extras da mesma mensagem (ex.: 3 fotos) → um item cada no chat, para abrir no CRM
  for (const extra of guardados.slice(1)) {
    await prisma.message.create({ data: { conversationId: result.conversationId, direction: 'inbound', senderType: 'contact', content: extra.compartilhado ? COMPARTILHOU : rotulo[extra.tipo], mediaUrl: extra.url, mediaType: extra.tipo } }).catch(() => {})
  }

  // 3) A resposta "final" do motor é gravada no banco mas NÃO enviada por ele (no WhatsApp quem envia é o
  //    webhook). Aqui mandamos pela ponte toda resposta desta rodada que ainda não saiu.
  const pendentes = await prisma.message.findMany({
    where: { conversationId: result.conversationId, direction: 'outbound', createdAt: { gte: inicio }, externalId: null, failedReason: null },
    orderBy: { createdAt: 'asc' }, select: { id: true, content: true, mediaUrl: true, mediaType: true },
  })
  for (const m of pendentes) {
    if (m.mediaUrl && m.mediaType) {
      // resposta com arquivo (ex.: ebook) → vai como ANEXO pela ponte (24/11/2026)
      const tipo = (['image', 'video', 'audio', 'document'] as const).find((t) => t === m.mediaType) ?? 'document'
      const legenda = /^\[.*\]$|^\[mídia\]$/.test(m.content?.trim() ?? '') ? '' : (m.content ?? '')
      await enviarDmPelaPonte(result.conversationId, m.id, legenda, input.externalId, { url: m.mediaUrl, type: tipo })
    } else if (m.content?.trim()) {
      await enviarDmPelaPonte(result.conversationId, m.id, m.content, input.externalId)
    }
  }
  // 📄 PDF do orçamento (Belenus) — depois do texto, como anexo pela ponte (enviar-arquivo.ts)
  if (result.documentoDepois) {
    const { enviarDocumentoDepois } = await import('@/lib/crm/belenus/auto')
    await enviarDocumentoDepois(result.documentoDepois)
  }
  // 2ª mensagem combinada pelo motor (ex.: fora do horário) — sai depois da resposta.
  if (result.followUp) {
    const { dispatchOutbound } = await import('@/lib/crm/flow')
    await dispatchOutbound(result.conversationId, result.followUp, undefined, 'ai').catch(() => {})
  }

  // 4) Interesse real (mandou a conta, pediu orçamento por kWh/R$, vai conversar com a esposa...) → convida
  //    UMA vez para seguir no WhatsApp, com o link que junta tudo no mesmo lead (convite-whatsapp.ts).
  try {
    const { interesseReal, criarConviteWhatsapp } = await import('@/lib/crm/convite-whatsapp')
    const mandouArquivo = !!imagem || (input.attachments ?? []).some((a) => /file|pdf|document/i.test(a.type))
    if (interesseReal(input.text, mandouArquivo)) {
      const conv = await prisma.conversation.findUnique({ where: { id: result.conversationId }, select: { aiEnabled: true, lead: { select: { aiEnabled: true, humanOnly: true } } } })
      if (conv?.aiEnabled && conv.lead?.aiEnabled && !conv.lead.humanOnly) {
        const texto = await criarConviteWhatsapp(result.contactId, result.leadId, input.channel)
        if (texto) {
          const { dispatchOutbound } = await import('@/lib/crm/flow')
          await dispatchOutbound(result.conversationId, texto, undefined, 'ai')
        }
      }
    }
  } catch (e) {
    console.error('[dm] convite para o WhatsApp falhou (ignorado):', e)
  }
}

/**
 * Envia UMA mensagem do CRM (já gravada, id = `messageId`) pelo Marketing. Devolve `false` quando a conversa não
 * é da ponte (aí o chamador segue o caminho antigo). Nunca lança; falha fica visível no Inbox (`failedReason`).
 */
export async function enviarDmPelaPonte(
  conversationId: string, messageId: string, text: string, replyToExternalId?: string,
  anexo?: { url: string; type: 'image' | 'video' | 'audio' | 'document'; name?: string },
): Promise<boolean> {
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

  // 📎 Anexo: a Meta baixa o arquivo de uma URL PÚBLICA. Anexo guardado no CRM (/api/uploads, só com login) vira
  //    link assinado (link-arquivo.ts); URL já pública (ex.: ebook no site) vai como está.
  let attachment: { type: 'image' | 'video' | 'audio' | 'file'; url: string; name?: string } | undefined
  if (anexo?.url) {
    const { linkPublicoDoAnexo } = await import('@/lib/crm/link-arquivo')
    const url = /\/api\/uploads\//.test(anexo.url) ? linkPublicoDoAnexo(anexo.url, anexo.name) : anexo.url
    if (!url || !/^https:\/\//.test(url)) { await falhar('Não entregue: o arquivo não tem um endereço público para a Meta baixar.'); return true }
    attachment = { type: anexo.type === 'document' ? 'file' : anexo.type, url, ...(anexo.name ? { name: anexo.name.slice(0, 200) } : {}) }
  }
  if (!text.trim() && !attachment) return true

  await prisma.message.update({ where: { id: messageId }, data: { externalId: `${PEDIDO_PENDENTE_PREFIX}${messageId}` } }).catch(() => {})
  const r = await nervo.publishSocialMessageSend({
    clientAccountId: bridge.clientAccountId, channel: bridge.channel, pageId: bridge.pageId, recipientId,
    text: text.trim(), requestId: messageId, ...(replyToExternalId ? { replyToExternalId } : {}),
    ...(attachment ? { attachment } : {}),
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
