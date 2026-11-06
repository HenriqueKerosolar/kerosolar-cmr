// Contrato de `social.engagement.captured`, publicado pelo Mind Marketing quando chega um comentário
// novo no Facebook ou Instagram — só leitura aqui: o Marketing é quem responde (auto-reply), o CRM só
// mostra pra quem atende ver. O payload ainda aceita `kind: 'dm'` porque o Marketing pode publicar DM
// também, mas o handler (socialEngagementHandler.ts) ignora: DM já chega direto no CRM pelo webhook
// próprio (src/app/api/webhooks/meta/route.ts) e apareceria duplicada em /inbox e /social. Hoje:
// comentário só existe pro Facebook (o Instagram não manda webhook de comentário do lado de lá).
import { z } from 'zod'

export const socialEngagementSchema = z.object({
  kind: z.enum(['comment', 'dm']),
  channel: z.enum(['facebook', 'instagram']),
  externalId: z.string().min(1).max(128),
  authorName: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(5000),
  postId: z.string().min(1).max(128).optional(),
  postPermalink: z.string().url().max(500).optional(),
})

export type SocialEngagementPayload = z.infer<typeof socialEngagementSchema>

export interface SocialEngagementRow extends SocialEngagementPayload {
  occurredAt: Date
}

/** `null` quando o payload não bate com o contrato — quem chama decide rejeitar (NervoRejection) ou só logar. */
export function parseSocialEngagement(payload: unknown, occurredAtIso: string): SocialEngagementRow | null {
  const parsed = socialEngagementSchema.safeParse(payload)
  if (!parsed.success) return null
  const occurredAt = new Date(occurredAtIso)
  if (Number.isNaN(occurredAt.getTime())) return null
  return { ...parsed.data, occurredAt }
}
