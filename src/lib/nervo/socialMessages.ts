// Mensagens diretas (Messenger e Instagram Direct) da KeroSolar que chegam pelo Mind Marketing, via Nervo.
// Contrato v1 combinado em 14/11/2026 (docs/plano-dm-meta-via-nervo.md) — a fonte da verdade é o lado do
// Marketing (D:\Projetos\Mide Marketing\bff\src\nervo\socialMessages.ts); estes esquemas têm os MESMOS campos:
//   Marketing -> CRM: `social.message.received` (uma mensagem que chegou na Página)
//   CRM -> Marketing: `social.message.send`     (resposta do CRM; ver crmNervo.publishSocialMessageSend)
//   Marketing -> CRM: `social.message.sent`     (resultado do envio, com o mesmo requestId)
// O Marketing continua dono da conexão com a Meta; o CRM só conversa. Este arquivo NÃO toca o banco
// (as dependências entram por parâmetro) para poder ser testado; quem liga ao Prisma é `dmBridge.ts`.
import { reject, type EventEnvelope } from '@lib/nervo'
import { z } from 'zod'

export const SOCIAL_MESSAGE_RECEIVED = 'social.message.received'
export const SOCIAL_MESSAGE_SEND = 'social.message.send'
export const SOCIAL_MESSAGE_SENT = 'social.message.sent'

export const socialMessageReceivedSchema = z.object({
  clientAccountId: z.string().min(1).max(128),
  externalId: z.string().min(1).max(256),
  channel: z.enum(['facebook', 'instagram']),
  pageId: z.string().min(1).max(128),
  senderId: z.string().min(1).max(128),
  senderName: z.string().max(256).optional(),
  text: z.string().max(20_000),
  attachments: z.array(z.object({ type: z.string().max(64), url: z.string().url().max(4096) })).max(20).optional(),
  sentAt: z.string().min(1).max(64),
  referral: z.object({ ref: z.string().max(512).optional(), source: z.string().max(128).optional(), adId: z.string().max(128).optional() }).optional(),
})
export type SocialMessageReceived = z.infer<typeof socialMessageReceivedSchema>

export const socialMessageSentSchema = z.object({
  clientAccountId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  externalId: z.string().max(256).optional(),
  error: z.object({ code: z.enum(['WINDOW_CLOSED', 'TOKEN_EXPIRED', 'NOT_CONNECTED', 'META_ERROR']), message: z.string().max(2000) }).optional(),
})
export type SocialMessageSent = z.infer<typeof socialMessageSentSchema>

/** Texto em português para o Inbox quando o envio falhou (nunca silencioso). */
export function motivoFalhaEnvio(error: SocialMessageSent['error']): string {
  switch (error?.code) {
    case 'WINDOW_CLOSED': return 'Não entregue: a janela de 24h da Meta fechou (o cliente precisa escrever de novo).'
    case 'TOKEN_EXPIRED': return 'Não entregue: a conexão do Marketing com a Meta expirou (reconectar no Mind Marketing).'
    case 'NOT_CONNECTED': return 'Não entregue: a Página não está liberada no Mind Marketing.'
    default: return `Não entregue pela Meta${error?.message ? ` — ${error.message}` : ''}.`
  }
}

export interface ReceivedHandlerDeps {
  /** Só a conta da KeroSolar no Marketing entra (MIND_MARKETING_CLIENT_ACCOUNT_ID). */
  clientAccountId: string
  /** Processa a mensagem (grava no Inbox, IA atende). Idempotente por `externalId`. */
  process(input: SocialMessageReceived): Promise<void>
  /**
   * Quanto esperar pelo processamento antes de devolver o "recebi" ao Mind (ms). O atendimento da IA pode
   * levar dezenas de segundos (tempo de digitação simulado) e a entrega do Mind tem tempo limite; a mensagem
   * do cliente é gravada logo no começo, então o restante segue em segundo plano. Padrão: 5 s.
   */
  ackAfterMs?: number
  log?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void
}

export function createSocialMessageReceivedHandler(deps: ReceivedHandlerDeps) {
  const ackAfterMs = deps.ackAfterMs ?? 5_000
  return async function handleSocialMessageReceived(event: EventEnvelope): Promise<void> {
    const parsed = socialMessageReceivedSchema.safeParse(event.payload)
    if (!parsed.success) reject(`payload inválido em ${event.type}`)
    const input = parsed.data
    if (input.clientAccountId !== deps.clientAccountId) reject('conta de cliente diferente da KeroSolar — ignorada')
    if (!input.text.trim() && !input.attachments?.length) return // nada para atender
    const trabalho = deps.process(input).catch((error: unknown) => {
      deps.log?.('error', 'DM da Meta: falha ao processar', { externalId: input.externalId, error: error instanceof Error ? error.message : String(error) })
    })
    // Responde ao Mind no que vier primeiro: fim do processamento ou o tempo limite (aí segue em segundo plano).
    await Promise.race([trabalho, new Promise((r) => setTimeout(r, ackAfterMs))])
  }
}

export interface SentHandlerDeps {
  clientAccountId: string
  /** Marca a mensagem do CRM (id = requestId) como entregue ou com falha. */
  markResult(result: SocialMessageSent): Promise<void>
}

export function createSocialMessageSentHandler(deps: SentHandlerDeps) {
  return async function handleSocialMessageSent(event: EventEnvelope): Promise<void> {
    const parsed = socialMessageSentSchema.safeParse(event.payload)
    if (!parsed.success) reject(`payload inválido em ${event.type}`)
    if (parsed.data.clientAccountId !== deps.clientAccountId) reject('conta de cliente diferente da KeroSolar — ignorada')
    await deps.markResult(parsed.data)
  }
}

// ─── Resposta a COMENTÁRIOS escrita no CRM (14/11/2026) ────────────────────────────────────────────────
//   CRM -> Marketing: `social.comment.reply`   { clientAccountId, channel, commentId, text, requestId }
//   Marketing -> CRM: `social.comment.replied` { clientAccountId, requestId, ok, replyId?, error? }
// O comentário chega pelo `social.engagement.captured` (commentId = o externalId dele). O Marketing continua
// respondendo comentários sozinho; isto só deixa o atendente responder também, pelo CRM, quando precisar.
export const SOCIAL_COMMENT_REPLY = 'social.comment.reply'
export const SOCIAL_COMMENT_REPLIED = 'social.comment.replied'

export const socialCommentRepliedSchema = z.object({
  clientAccountId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  replyId: z.string().max(256).optional(),
  error: z.object({ code: z.enum(['TOKEN_EXPIRED', 'NOT_CONNECTED', 'NOT_FOUND', 'META_ERROR']), message: z.string().max(2000) }).optional(),
})
export type SocialCommentReplied = z.infer<typeof socialCommentRepliedSchema>

export function motivoFalhaComentario(error: SocialCommentReplied['error']): string {
  switch (error?.code) {
    case 'NOT_FOUND': return 'Não respondido: o comentário foi apagado ou não existe mais na Meta.'
    case 'TOKEN_EXPIRED': return 'Não respondido: a conexão do Marketing com a Meta expirou (reconectar no Mind Marketing).'
    case 'NOT_CONNECTED': return 'Não respondido: a Página não está liberada no Mind Marketing.'
    default: return `Não respondido pela Meta${error?.message ? ` — ${error.message}` : ''}.`
  }
}

export function createSocialCommentRepliedHandler(deps: { clientAccountId: string; markResult(result: SocialCommentReplied): Promise<void> }) {
  return async function handleSocialCommentReplied(event: EventEnvelope): Promise<void> {
    const parsed = socialCommentRepliedSchema.safeParse(event.payload)
    if (!parsed.success) reject(`payload inválido em ${event.type}`)
    if (parsed.data.clientAccountId !== deps.clientAccountId) reject('conta de cliente diferente da KeroSolar — ignorada')
    await deps.markResult(parsed.data)
  }
}
