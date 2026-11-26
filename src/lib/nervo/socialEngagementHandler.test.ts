import { describe, expect, it, vi } from 'vitest'
import { NervoRejection } from '@lib/nervo'
import { createSocialEngagementHandler } from './socialEngagementHandler'
import { commentPush } from './socialEngagement'

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

  it('avisa o celular só para comentário NOVO (reentrega do Nervo não avisa de novo); falha do aviso não derruba', async () => {
    const notify = vi.fn().mockResolvedValue(undefined)
    const novo = createSocialEngagementHandler({ upsert: vi.fn().mockResolvedValue(true), notify })
    await novo(envelope({ kind: 'comment', channel: 'facebook', externalId: 'c3', authorName: 'Henrique Leal', text: 'Gostei' }))
    expect(notify).toHaveBeenCalledTimes(1)

    const reentrega = createSocialEngagementHandler({ upsert: vi.fn().mockResolvedValue(false), notify })
    await reentrega(envelope({ kind: 'comment', channel: 'facebook', externalId: 'c3', authorName: 'Henrique Leal', text: 'Gostei' }))
    expect(notify).toHaveBeenCalledTimes(1)

    const falha = createSocialEngagementHandler({ upsert: vi.fn().mockResolvedValue(true), notify: vi.fn().mockRejectedValue(new Error('push')) })
    await expect(falha(envelope({ kind: 'comment', channel: 'instagram', externalId: 'c4', text: 'Oi' }))).resolves.toBeUndefined()
  })

  it('aviso de comentário tem título fixo (a EVA separa autor e rede por ele)', () => {
    const p = commentPush({ kind: 'comment', channel: 'instagram', externalId: 'c5', authorName: 'Ana', text: 'Qto custa?', occurredAt: new Date() })
    expect(p).toMatchObject({ title: '💬 Comentário no Instagram · Ana', body: 'Qto custa?', url: '/social', tag: 'comment-c5' })
  })
})
