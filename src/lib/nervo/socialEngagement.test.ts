import { describe, expect, it } from 'vitest'
import { parseSocialEngagement } from './socialEngagement'

describe('parseSocialEngagement', () => {
  it('aceita um comentário válido (Facebook)', () => {
    const row = parseSocialEngagement(
      { kind: 'comment', channel: 'facebook', externalId: 'c123', authorName: 'João', text: 'Quanto custa?', postId: 'p1', postPermalink: 'https://fb.com/p1' },
      '2026-11-05T12:00:00.000Z',
    )
    expect(row).toMatchObject({ kind: 'comment', channel: 'facebook', externalId: 'c123', authorName: 'João', text: 'Quanto custa?' })
    expect(row?.occurredAt).toEqual(new Date('2026-11-05T12:00:00.000Z'))
  })

  it('aceita uma DM sem authorName (não vem da Meta sem consulta extra)', () => {
    const row = parseSocialEngagement({ kind: 'dm', channel: 'instagram', externalId: 'mid1', text: 'Oi, quero saber mais' }, '2026-11-05T12:00:00.000Z')
    expect(row).toMatchObject({ kind: 'dm', channel: 'instagram', externalId: 'mid1', text: 'Oi, quero saber mais' })
    expect(row?.authorName).toBeUndefined()
  })

  it('aceita postThumbnailUrl (capa do post) quando vem no payload', () => {
    const row = parseSocialEngagement(
      { kind: 'comment', channel: 'facebook', externalId: 'c124', text: 'Opa', postThumbnailUrl: 'https://scontent.meta.com/p1.jpg' },
      '2026-11-05T12:00:00.000Z',
    )
    expect(row?.postThumbnailUrl).toBe('https://scontent.meta.com/p1.jpg')
  })

  it('aceita comentário sem postThumbnailUrl (nem todo evento antigo vai ter)', () => {
    const row = parseSocialEngagement({ kind: 'comment', channel: 'facebook', externalId: 'c125', text: 'Opa' }, '2026-11-05T12:00:00.000Z')
    expect(row?.postThumbnailUrl).toBeUndefined()
  })

  it('rejeita postThumbnailUrl que não é URL válida', () => {
    expect(
      parseSocialEngagement({ kind: 'comment', channel: 'facebook', externalId: 'c126', text: 'Opa', postThumbnailUrl: 'não-é-url' }, '2026-11-05T12:00:00.000Z'),
    ).toBeNull()
  })

  it('rejeita payload sem os campos obrigatórios', () => {
    expect(parseSocialEngagement({ kind: 'comment', channel: 'facebook' }, '2026-11-05T12:00:00.000Z')).toBeNull()
  })

  it('rejeita kind/channel fora do contrato', () => {
    expect(parseSocialEngagement({ kind: 'like', channel: 'facebook', externalId: 'x', text: 'y' }, '2026-11-05T12:00:00.000Z')).toBeNull()
    expect(parseSocialEngagement({ kind: 'comment', channel: 'tiktok', externalId: 'x', text: 'y' }, '2026-11-05T12:00:00.000Z')).toBeNull()
  })

  it('rejeita occurredAt inválido', () => {
    expect(parseSocialEngagement({ kind: 'comment', channel: 'facebook', externalId: 'x', text: 'y' }, 'não é data')).toBeNull()
  })
})
