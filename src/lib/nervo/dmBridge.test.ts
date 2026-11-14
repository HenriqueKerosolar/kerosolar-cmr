import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = {
  message: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  contact: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  conversation: { findUnique: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const janela = { aberta: true }
vi.mock('@/lib/crm/flow', () => ({ janelaAberta: vi.fn(async () => janela.aberta), dispatchOutbound: vi.fn() }))

const nervoState: { nervo: { publishSocialMessageSend: ReturnType<typeof vi.fn> } | undefined } = { nervo: undefined }
vi.mock('./fromEnv', () => ({ getCrmNervo: () => nervoState.nervo }))

const ingest = vi.fn()
vi.mock('@/lib/crm/engine', () => ({ ingestMessage: (...a: unknown[]) => ingest(...a) }))

const { enviarDmPelaPonte, marcarResultadoEnvio, processarDmRecebida, PEDIDO_PENDENTE_PREFIX } = await import('./dmBridge')

const CONTA = '9b1f177e-9bcf-44da-93e9-53aa994ab9ae'
const convFacebook = { channel: 'facebook', contact: { facebookId: 'psid1', instagramId: null, customFields: { metaBridge: { clientAccountId: CONTA, pageId: 'p1', channel: 'facebook' } } } }

beforeEach(() => {
  vi.clearAllMocks()
  janela.aberta = true
  nervoState.nervo = { publishSocialMessageSend: vi.fn().mockResolvedValue('queued') }
  db.message.update.mockResolvedValue({})
})

describe('enviarDmPelaPonte', () => {
  it('publica social.message.send com requestId = id da mensagem e marca como pendente', async () => {
    db.conversation.findUnique.mockResolvedValue(convFacebook)
    expect(await enviarDmPelaPonte('conv1', 'msg1', 'Olá!', 'm_1')).toBe(true)
    expect(nervoState.nervo!.publishSocialMessageSend).toHaveBeenCalledWith({ clientAccountId: CONTA, channel: 'facebook', pageId: 'p1', recipientId: 'psid1', text: 'Olá!', requestId: 'msg1', replyToExternalId: 'm_1' })
    expect(db.message.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { externalId: `${PEDIDO_PENDENTE_PREFIX}msg1` } })
  })

  it('conversa que NÃO é da ponte → false (segue o caminho antigo)', async () => {
    db.conversation.findUnique.mockResolvedValue({ channel: 'whatsapp', contact: {} })
    expect(await enviarDmPelaPonte('conv1', 'msg1', 'Olá!')).toBe(false)
    db.conversation.findUnique.mockResolvedValue({ channel: 'facebook', contact: { facebookId: 'x', customFields: {} } })
    expect(await enviarDmPelaPonte('conv1', 'msg1', 'Olá!')).toBe(false)
  })

  it('Nervo desligado → falha VISÍVEL na mensagem, CRM segue funcionando (não lança)', async () => {
    nervoState.nervo = undefined
    db.conversation.findUnique.mockResolvedValue(convFacebook)
    expect(await enviarDmPelaPonte('conv1', 'msg1', 'Olá!')).toBe(true)
    expect(db.message.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { failedReason: expect.stringContaining('não está conectado ao Mind') } })
  })

  it('janela de 24h fechada → não pede envio e registra o motivo', async () => {
    janela.aberta = false
    db.conversation.findUnique.mockResolvedValue(convFacebook)
    await enviarDmPelaPonte('conv1', 'msg1', 'Olá!')
    expect(nervoState.nervo!.publishSocialMessageSend).not.toHaveBeenCalled()
    expect(db.message.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { failedReason: expect.stringContaining('janela de 24h') } })
  })

  it('CRM não pareado → falha visível pedindo para aceitar no Mind', async () => {
    nervoState.nervo!.publishSocialMessageSend.mockResolvedValue('unpaired')
    db.conversation.findUnique.mockResolvedValue(convFacebook)
    await enviarDmPelaPonte('conv1', 'msg1', 'Olá!')
    expect(db.message.update).toHaveBeenLastCalledWith({ where: { id: 'msg1' }, data: { failedReason: expect.stringContaining('aceite o pareamento') } })
  })
})

describe('marcarResultadoEnvio', () => {
  it('ok → grava o mid da Meta e limpa falha', async () => {
    db.message.findUnique.mockResolvedValue({ id: 'msg1' })
    await marcarResultadoEnvio({ clientAccountId: CONTA, requestId: 'msg1', ok: true, externalId: 'mid.9' })
    expect(db.message.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: expect.objectContaining({ externalId: 'mid.9', failedReason: null }) })
  })

  it('falha → motivo em português no Inbox', async () => {
    db.message.findUnique.mockResolvedValue({ id: 'msg1' })
    await marcarResultadoEnvio({ clientAccountId: CONTA, requestId: 'msg1', ok: false, error: { code: 'TOKEN_EXPIRED', message: 'x' } })
    expect(db.message.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { failedReason: expect.stringContaining('expirou') } })
  })

  it('mensagem apagada → não faz nada (reentrega segura)', async () => {
    db.message.findUnique.mockResolvedValue(null)
    await marcarResultadoEnvio({ clientAccountId: CONTA, requestId: 'sumiu', ok: true })
    expect(db.message.update).not.toHaveBeenCalled()
  })
})

describe('processarDmRecebida', () => {
  const input = { clientAccountId: CONTA, externalId: 'm_1', channel: 'facebook' as const, pageId: 'p1', senderId: 'psid1', senderName: 'Ana', text: 'Quanto custa?', sentAt: '2026-11-14T12:00:00.000Z' }

  it('reentrega (mesmo externalId já gravado) → não atende de novo', async () => {
    db.message.findFirst.mockResolvedValue({ id: 'já' })
    await processarDmRecebida(input)
    expect(ingest).not.toHaveBeenCalled()
    expect(db.contact.create).not.toHaveBeenCalled()
  })

  it('mensagem nova → grava o endereço da conversa ANTES de atender e manda a resposta pela ponte', async () => {
    db.message.findFirst.mockResolvedValue(null)
    db.contact.findFirst.mockResolvedValue(null)
    db.contact.create.mockResolvedValue({})
    ingest.mockResolvedValue({ conversationId: 'conv1', reply: 'Olá Ana!' })
    db.message.findMany.mockResolvedValue([{ id: 'resp1', content: 'Olá Ana!', mediaUrl: null }])
    db.conversation.findUnique.mockResolvedValue(convFacebook)
    await processarDmRecebida(input)
    expect(db.contact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ facebookId: 'psid1', customFields: { metaBridge: { clientAccountId: CONTA, pageId: 'p1', channel: 'facebook' } } }) })
    expect(db.contact.create.mock.invocationCallOrder[0]).toBeLessThan(ingest.mock.invocationCallOrder[0]!)
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ channel: 'facebook', externalId: 'psid1', externalMessageId: 'm_1', text: 'Quanto custa?' }))
    expect(nervoState.nervo!.publishSocialMessageSend).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'resp1', text: 'Olá Ana!', replyToExternalId: 'm_1' }))
  })
})
