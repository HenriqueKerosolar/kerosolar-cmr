import { describe, expect, it, vi } from 'vitest'
import { NervoRejection } from '@lib/nervo'
import { createSocialEngagementHandler } from './socialEngagementHandler'

function envelope(payload: unknown, occurredAt = '2026-11-05T12:00:00.000Z') {
  return { id: 'evt1', type: 'social.engagement.captured', version: 1, tenant: 't1', occurredAt, correlationId: 'c1', payload } as any
}

describe('createSocialEngagementHandler', () => {
  it('grava a linha quando o payload é válido', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    const handler = createSocialEngagementHandler({ upsert })

    await handler(envelope({ kind: 'comment', channel: 'facebook', externalId: 'c1', authorName: 'Ana', text: 'Oi' }))

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![0]).toMatchObject({ kind: 'comment', channel: 'facebook', externalId: 'c1', authorName: 'Ana', text: 'Oi' })
  })

  it('recusa (NervoRejection, não repetível) payload inválido — e nunca chama upsert', async () => {
    const upsert = vi.fn()
    const handler = createSocialEngagementHandler({ upsert })

    await expect(handler(envelope({ kind: 'like' }))).rejects.toBeInstanceOf(NervoRejection)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('propaga falha do upsert (ex.: banco fora do ar) — o Nervo reentrega depois', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const handler = createSocialEngagementHandler({ upsert })

    await expect(handler(envelope({ kind: 'comment', channel: 'facebook', externalId: 'c2', text: 'Oi' }))).rejects.toThrow('ECONNREFUSED')
  })

  it('ignora kind "dm" (já chega direto no CRM pelo webhook da Meta) — sem gravar, sem rejeitar', async () => {
    const upsert = vi.fn()
    const handler = createSocialEngagementHandler({ upsert })

    await handler(envelope({ kind: 'dm', channel: 'instagram', externalId: 'm1', text: 'Oi' }))

    expect(upsert).not.toHaveBeenCalled()
  })
})
