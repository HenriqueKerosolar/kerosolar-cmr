// Handler do evento `social.engagement.captured` (entrada do Nervo): grava o comentário pra aparecer
// na tela. `kind: 'dm'` é ignorado de propósito — a DM já chega direto no CRM pelo webhook próprio da
// Meta (src/app/api/webhooks/meta/route.ts) e apareceria duplicada em /inbox e /social. Payload
// inválido é recusado (NERVO_REJECTED — não é repetível, o Mind não insiste); qualquer outra falha
// (ex.: banco fora do ar) sobe pra ser tratada como falha repetível pelo receptor do Nervo, que
// reentrega depois — nunca perdemos um comentário por uma falha passageira.
import { reject, type EventEnvelope } from '@lib/nervo'
import { parseSocialEngagement, type SocialEngagementRow } from './socialEngagement'

export interface SocialEngagementHandlerDeps {
  /** Idempotente por `externalId` (upsert): reentrega do Nervo nunca duplica a linha. */
  upsert(row: SocialEngagementRow): Promise<void>
}

export function createSocialEngagementHandler(deps: SocialEngagementHandlerDeps) {
  return async function handleSocialEngagementCaptured(event: EventEnvelope): Promise<void> {
    const row = parseSocialEngagement(event.payload, event.occurredAt)
    if (!row) reject(`payload inválido em ${event.type}`)
    if (row.kind === 'dm') return
    await deps.upsert(row)
  }
}
