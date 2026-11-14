// Este CRM como sistema do ecossistema (Nervo): publica o desfecho comercial do lead (lead.won / lead.lost)
// para o Mind Marketing, que já assina esses eventos e grava como conversão real (receita de verdade —
// hoje toda venda aparece "sem atribuição" do lado do Marketing). Tudo passa pelo Nervo Central (o Mind);
// nada de conector avulso. `lead.qualified` fica de fora: não há estágio "isQualified" no schema deste CRM.
//
// Pareamento automático (igual ao Mind Marketing): a única configuração é o endereço do Mind
// (NERVO_BASE_URL). O dono aceita UM pedido no painel do Mind e a credencial (Key, tenant, segredo de
// entrega) chega direto a este CRM, que a guarda cifrada no próprio banco (tabela `nervo_connection`).
//
// Durabilidade: a CONEXÃO pareada, a caixa de SAÍDA e a caixa de ENTRADA ficam em Postgres
// (`nervo_connection`, `nervo_outbox`, `nervo_inbox`). Desde as DMs da Meta (14/11/2026) a caixa de saída
// leva RESPOSTAS A CLIENTES (`social.message.send`): não pode se perder num reinício do Railway. O envio
// sai na hora do evento (`sendNow`); o que falhar fica pendente e sai no cron DIÁRIO de segurança
// (`tick()` — regra do dono: nada de cron em minutos).
import { createNervoConnection, createPostgresConnectionStore, createPostgresInbox, createPostgresOutbox, isNervoError, redact, type Connection, type ConnectionStatus, type EventHandler, type FetchLike, type InboundRequest, type InboundResponse, type PgQuery } from '@lib/nervo'
import type { NervoConfig } from './config'

export const NERVO_PRODUCT_ID = 'kerosolar-crm'
export const NERVO_PRODUCT_NAME = 'KeroSolar CRM'
export const NERVO_PRODUCT_VERSION = '1.0.0'

type Log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void

export interface CrmNervoDeps {
  config: NervoConfig
  query: PgQuery
  fetch?: FetchLike
  now?: () => number
  log?: Log
  /** Injetável nos testes. Padrão: `createNervoConnection` de verdade. */
  connection?: Pick<Connection, 'publish' | 'advance' | 'on' | 'receive'> & Partial<Pick<Connection, 'status' | 'tick'>>
}

/** `social.message.send` v1 — contrato combinado com o Mind Marketing (bff/src/nervo/socialMessages.ts de lá). */
export interface SocialMessageSendPayload {
  clientAccountId: string
  channel: 'facebook' | 'instagram'
  pageId: string
  recipientId: string
  text: string
  /** Id ÚNICO do pedido (usamos o id da Message do CRM): o Marketing deduplica por ele e devolve no `social.message.sent`. */
  requestId: string
  replyToExternalId?: string
}

export interface LeadOutcomeInput {
  leadId: string
  contactPhone?: string | null
}

export interface LeadWonInput extends LeadOutcomeInput {
  /** Valor da venda em reais (Lead.value do Prisma — já é reais, não centavos). */
  valueReais: number
}

export interface CrmNervo {
  /** Melhor esforço: NUNCA lança. A troca de estágio no banco já aconteceu antes desta chamada. */
  publishLeadWon(input: LeadWonInput): Promise<void>
  /** Melhor esforço: NUNCA lança. */
  publishLeadLost(input: LeadOutcomeInput): Promise<void>
  /** Registra um handler pra um evento que o Mind entrega (ex.: `social.engagement.captured`). */
  on(type: string, handler: EventHandler): void
  /** Ponto de entrada do que o Mind entrega — ligue à rota HTTP de inbound deste CRM. */
  receive(req: InboundRequest): Promise<InboundResponse>
  /**
   * Pede ao Marketing para entregar uma resposta na Meta. NUNCA lança: `queued` (sai assim que der — a caixa
   * de saída é durável), `unpaired` (CRM ainda não conectado ao Mind: a resposta NÃO sai) ou `error`.
   */
  publishSocialMessageSend(payload: SocialMessageSendPayload): Promise<'queued' | 'unpaired' | 'error'>
  /** Estado da conexão com o Mind SEM falar com ele (para a tela). */
  status(): Promise<ConnectionStatus | undefined>
  /** Um passo do pareamento (pede ao Mind / confere se o dono aceitou). `restart` = pedir de novo. */
  advance(restart?: boolean): Promise<ConnectionStatus | undefined>
  /** advance + envio do que ficou pendente: o cron DIÁRIO de segurança e o botão "Verificar agora". */
  tick(): Promise<void>
}

function errorText(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error))
}

export function createCrmNervo(deps: CrmNervoDeps): CrmNervo {
  const { config } = deps
  const log: Log = deps.log ?? (() => undefined)
  const connection =
    deps.connection ??
    createNervoConnection({
      mindUrl: config.baseUrl,
      product: { id: NERVO_PRODUCT_ID, name: NERVO_PRODUCT_NAME, version: NERVO_PRODUCT_VERSION, environment: config.environment },
      installationId: config.installationId,
      inbound: { url: config.inboundUrl },
      store: createPostgresConnectionStore(deps.query),
      outbox: createPostgresOutbox(deps.query),
      inbox: createPostgresInbox(deps.query),
      provides: { events: [{ type: 'lead.won' }, { type: 'lead.lost' }, { type: 'social.message.send' }] },
      seal: { secrets: config.sealSecrets },
      timeoutMs: 8_000,
      retries: 1,
      breakerThreshold: 0,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      log,
    })

  async function publish(type: 'lead.won' | 'lead.lost', input: LeadOutcomeInput, valueCents: number | undefined): Promise<void> {
    try {
      // Avança o pareamento (1º pedido ao Mind, ou confere se o dono já aceitou) antes de publicar: é o
      // único gatilho "por evento" deste CRM — sem isso, nada jamais pede o pareamento ao Mind. Melhor
      // esforço: uma falha aqui não impede a tentativa de publicar (que vai cair em NERVO_UNPAIRED).
      await connection.advance().catch(() => undefined)
      await connection.publish(
        type,
        {
          clientAccountId: config.mindMarketingClientAccountId,
          leadId: input.leadId,
          ...(valueCents !== undefined ? { valueCents, currency: 'BRL' } : {}),
          occurredAt: new Date().toISOString(),
          ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
        },
        { correlationId: `${input.leadId}:${type}` },
      )
    } catch (error) {
      if (isNervoError(error) && error.code === 'NERVO_UNPAIRED') {
        // Esperado enquanto o dono não aceitou o pedido no Mind (ou depois de uma revogação): a peça não enfileira sem tenant.
        log('info', `Nervo: ${type} não enviado porque o CRM ainda não está conectado ao Mind (o lead já foi movido aqui)`, { leadId: input.leadId })
        return
      }
      log('warn', `Nervo: não consegui publicar ${type} (o lead já foi movido no CRM; o evento não foi enviado)`, { error: errorText(error), leadId: input.leadId })
    }
  }

  return {
    publishLeadWon: (input) => publish('lead.won', input, Math.round(input.valueReais * 100)),
    publishLeadLost: (input) => publish('lead.lost', input, undefined),
    on: (type, handler) => connection.on(type, handler),
    receive: (req) => connection.receive(req),
    async publishSocialMessageSend(payload) {
      try {
        await connection.publish('social.message.send', payload, { correlationId: payload.requestId })
        return 'queued'
      } catch (error) {
        if (isNervoError(error) && error.code === 'NERVO_UNPAIRED') {
          log('warn', 'Nervo: resposta de DM NÃO enviada — o CRM não está conectado ao Mind', { requestId: payload.requestId })
          return 'unpaired'
        }
        log('error', 'Nervo: falha ao enfileirar resposta de DM', { error: errorText(error), requestId: payload.requestId })
        return 'error'
      }
    },
    status: async () => (connection.status ? connection.status().catch(() => undefined) : undefined),
    advance: async (restart) => connection.advance(restart ? { restart: true } : undefined).catch(() => undefined),
    tick: async () => {
      if (connection.tick) await connection.tick().catch((e: unknown) => log('warn', 'Nervo: tick falhou', { error: errorText(e) }))
    },
  }
}
