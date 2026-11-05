import { describe, expect, it, vi } from 'vitest'
import { NervoError } from '@lib/nervo'
import { createCrmNervo } from './crmNervo'
import type { NervoConfig } from './config'

const config: NervoConfig = {
  baseUrl: 'https://mind.example.com',
  installationId: 'kerosolar-crm-test',
  environment: 'development',
  inboundUrl: 'https://crm.example.com/api/public/nervo/inbound',
  sealSecrets: ['s'.repeat(32)],
  mindMarketingClientAccountId: '9b1f177e-9bcf-44da-93e9-53aa994ab9ae',
}

const noopOn = vi.fn()
const noopReceive = vi.fn().mockResolvedValue({ status: 503, body: {} })

function nervoWith(publish: ReturnType<typeof vi.fn>) {
  const advance = vi.fn().mockResolvedValue({ state: 'paired' })
  return createCrmNervo({ config, query: vi.fn(), connection: { publish, advance, on: noopOn, receive: noopReceive } })
}

describe('createCrmNervo', () => {
  it('lead.won publica com o valor certo (reais convertido pra centavos, arredondado)', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'evt1', duplicate: false, queued: true })
    const nervo = nervoWith(publish)

    await nervo.publishLeadWon({ leadId: 'lead1', valueReais: 1234.567, contactPhone: '5511999998888' })

    expect(publish).toHaveBeenCalledTimes(1)
    const [type, payload, opts] = publish.mock.calls[0]!
    expect(type).toBe('lead.won')
    expect(payload).toMatchObject({
      clientAccountId: config.mindMarketingClientAccountId,
      leadId: 'lead1',
      valueCents: 123457,
      currency: 'BRL',
      contactPhone: '5511999998888',
    })
    expect(typeof payload.occurredAt).toBe('string')
    expect(opts).toMatchObject({ correlationId: 'lead1:lead.won' })
  })

  it('lead.lost publica sem valor e sem telefone quando o contato não tem telefone', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'evt2', duplicate: false, queued: true })
    const nervo = nervoWith(publish)

    await nervo.publishLeadLost({ leadId: 'lead2', contactPhone: null })

    expect(publish).toHaveBeenCalledTimes(1)
    const [type, payload] = publish.mock.calls[0]!
    expect(type).toBe('lead.lost')
    expect(payload).not.toHaveProperty('valueCents')
    expect(payload).not.toHaveProperty('contactPhone')
    expect(payload).toMatchObject({ clientAccountId: config.mindMarketingClientAccountId, leadId: 'lead2' })
  })

  it('falha de rede (ou qualquer erro do Nervo) nunca lança — é melhor esforço', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const nervo = nervoWith(publish)

    await expect(nervo.publishLeadWon({ leadId: 'lead3', valueReais: 100 })).resolves.toBeUndefined()
    await expect(nervo.publishLeadLost({ leadId: 'lead3' })).resolves.toBeUndefined()
  })

  it('NERVO_UNPAIRED (ainda sem pareamento aceito) também nunca lança', async () => {
    const publish = vi.fn().mockRejectedValue(new NervoError('NERVO_UNPAIRED', 'sem conexão'))
    const nervo = nervoWith(publish)

    await expect(nervo.publishLeadWon({ leadId: 'lead4', valueReais: 50 })).resolves.toBeUndefined()
  })

  it('avança o pareamento (advance) antes de publicar — é o que pede o pareamento ao Mind na 1ª vez', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'evt5', duplicate: false, queued: true })
    const advance = vi.fn().mockResolvedValue({ state: 'pending', userCode: 'ABCD-1234' })
    const nervo = createCrmNervo({ config, query: vi.fn(), connection: { publish, advance, on: noopOn, receive: noopReceive } })

    await nervo.publishLeadWon({ leadId: 'lead5', valueReais: 10 })

    expect(advance).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('falha do advance() (ex.: banco fora do ar) não impede a tentativa de publicar', async () => {
    const publish = vi.fn().mockRejectedValue(new NervoError('NERVO_UNPAIRED', 'sem conexão'))
    const advance = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const nervo = createCrmNervo({ config, query: vi.fn(), connection: { publish, advance, on: noopOn, receive: noopReceive } })

    await expect(nervo.publishLeadLost({ leadId: 'lead6' })).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('on()/receive() repassam direto pra conexão (é a entrada do que o Mind entrega)', async () => {
    const on = vi.fn()
    const receive = vi.fn().mockResolvedValue({ status: 200, body: { status: 'processed' } })
    const nervo = createCrmNervo({ config, query: vi.fn(), connection: { publish: vi.fn(), advance: vi.fn(), on, receive } })

    const handler = vi.fn()
    nervo.on('social.engagement.captured', handler)
    expect(on).toHaveBeenCalledWith('social.engagement.captured', handler)

    const req = { headers: {}, body: '{}' }
    await expect(nervo.receive(req)).resolves.toEqual({ status: 200, body: { status: 'processed' } })
    expect(receive).toHaveBeenCalledWith(req)
  })
})
