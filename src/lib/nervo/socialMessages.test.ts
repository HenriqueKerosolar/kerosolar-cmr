import { describe, expect, it, vi } from 'vitest'
import { NervoRejection } from '@lib/nervo'
import { createSocialMessageReceivedHandler, createSocialMessageSentHandler, motivoFalhaEnvio } from './socialMessages'

const CONTA = '9b1f177e-9bcf-44da-93e9-53aa994ab9ae'

function envelope(type: string, payload: unknown) {
  return { id: 'evt1', type, version: 1, tenant: 't1', occurredAt: '2026-11-14T12:00:00.000Z', correlationId: 'c1', payload } as any
}

const recebida = (extra: Record<string, unknown> = {}) => ({
  clientAccountId: CONTA, externalId: 'm_1', channel: 'facebook', pageId: 'p1', senderId: 'psid1',
  senderName: 'Ana', text: 'Quanto custa?', sentAt: '2026-11-14T12:00:00.000Z', ...extra,
})

describe('social.message.received', () => {
  it('processa a mensagem válida da KeroSolar', async () => {
    const process = vi.fn().mockResolvedValue(undefined)
    await createSocialMessageReceivedHandler({ clientAccountId: CONTA, process })(envelope('social.message.received', recebida()))
    expect(process).toHaveBeenCalledTimes(1)
    expect(process.mock.calls[0]![0]).toMatchObject({ externalId: 'm_1', channel: 'facebook', senderId: 'psid1', text: 'Quanto custa?' })
  })

  it('recusa payload inválido (NervoRejection, sem reenvio) e não processa', async () => {
    const process = vi.fn()
    const h = createSocialMessageReceivedHandler({ clientAccountId: CONTA, process })
    await expect(h(envelope('social.message.received', { ...recebida(), channel: 'whatsapp' }))).rejects.toBeInstanceOf(NervoRejection)
    await expect(h(envelope('social.message.received', { text: 'oi' }))).rejects.toBeInstanceOf(NervoRejection)
    expect(process).not.toHaveBeenCalled()
  })

  it('recusa mensagem de OUTRA conta de cliente (só a KeroSolar entra)', async () => {
    const process = vi.fn()
    const h = createSocialMessageReceivedHandler({ clientAccountId: CONTA, process })
    await expect(h(envelope('social.message.received', recebida({ clientAccountId: 'outra' })))).rejects.toBeInstanceOf(NervoRejection)
    expect(process).not.toHaveBeenCalled()
  })

  it('aceita mensagem só com anexo (foto da conta) e ignora mensagem vazia', async () => {
    const process = vi.fn().mockResolvedValue(undefined)
    const h = createSocialMessageReceivedHandler({ clientAccountId: CONTA, process })
    await h(envelope('social.message.received', recebida({ text: '', attachments: [{ type: 'image', url: 'https://cdn.exemplo/conta.jpg' }] })))
    await h(envelope('social.message.received', recebida({ text: '   ' })))
    expect(process).toHaveBeenCalledTimes(1)
  })

  it('responde ao Mind no tempo limite mesmo com o atendimento ainda rodando (segue em segundo plano)', async () => {
    let terminou = false
    const process = vi.fn(() => new Promise<void>((r) => setTimeout(() => { terminou = true; r() }, 300)))
    const inicio = Date.now()
    await createSocialMessageReceivedHandler({ clientAccountId: CONTA, process, ackAfterMs: 30 })(envelope('social.message.received', recebida()))
    expect(Date.now() - inicio).toBeLessThan(250)
    expect(terminou).toBe(false)
  })

  it('falha no atendimento não derruba a entrega (fica no log)', async () => {
    const log = vi.fn()
    const process = vi.fn().mockRejectedValue(new Error('banco fora'))
    await createSocialMessageReceivedHandler({ clientAccountId: CONTA, process, log, ackAfterMs: 50 })(envelope('social.message.received', recebida()))
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('falha ao processar'), expect.objectContaining({ externalId: 'm_1' }))
  })
})

describe('social.message.sent', () => {
  it('marca o resultado (ok e falha)', async () => {
    const markResult = vi.fn().mockResolvedValue(undefined)
    const h = createSocialMessageSentHandler({ clientAccountId: CONTA, markResult })
    await h(envelope('social.message.sent', { clientAccountId: CONTA, requestId: 'msg1', ok: true, externalId: 'mid.1' }))
    await h(envelope('social.message.sent', { clientAccountId: CONTA, requestId: 'msg2', ok: false, error: { code: 'WINDOW_CLOSED', message: 'x' } }))
    expect(markResult).toHaveBeenCalledTimes(2)
    expect(markResult.mock.calls[1]![0]).toMatchObject({ requestId: 'msg2', ok: false, error: { code: 'WINDOW_CLOSED' } })
  })

  it('recusa payload inválido e conta diferente', async () => {
    const markResult = vi.fn()
    const h = createSocialMessageSentHandler({ clientAccountId: CONTA, markResult })
    await expect(h(envelope('social.message.sent', { requestId: 'x' }))).rejects.toBeInstanceOf(NervoRejection)
    await expect(h(envelope('social.message.sent', { clientAccountId: 'outra', requestId: 'x', ok: true }))).rejects.toBeInstanceOf(NervoRejection)
    expect(markResult).not.toHaveBeenCalled()
  })

  it('motivo da falha em português para o Inbox (nunca silencioso)', () => {
    expect(motivoFalhaEnvio({ code: 'WINDOW_CLOSED', message: '' })).toMatch(/janela de 24h/)
    expect(motivoFalhaEnvio({ code: 'TOKEN_EXPIRED', message: '' })).toMatch(/expirou/)
    expect(motivoFalhaEnvio({ code: 'META_ERROR', message: 'limite' })).toMatch(/limite/)
  })
})
