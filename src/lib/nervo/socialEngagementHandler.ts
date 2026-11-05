// Handler do evento `social.engagement.captured` (entrada do Nervo): grava o comentário/DM pra
// aparecer na tela. Payload inválido é recusado (NERVO_REJECTED — não é repetível, o Mind não insiste);
// qualquer outra falha (ex.: banco fora do ar) sobe pra ser tratada como falha repetível pelo receptor
// do Nervo, que reentrega depois — nunca perdemos um engajamento por uma falha passageira.
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
    await deps.upsert(row)
  }
}
