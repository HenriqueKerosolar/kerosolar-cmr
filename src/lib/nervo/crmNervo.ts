// Este CRM como sistema do ecossistema (Nervo): publica o desfecho comercial do lead (lead.won / lead.lost)
// para o Mind Marketing, que já assina esses eventos e grava como conversão real (receita de verdade —
// hoje toda venda aparece "sem atribuição" do lado do Marketing). Tudo passa pelo Nervo Central (o Mind);
// nada de conector avulso. `lead.qualified` (15/11/2026): lead que passa da etapa "Financiamento pedido de
// documentos" — a regra fica em leadOutcome.ts.
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

/** `social.comment.reply` v1 — o atendente responde um comentário pelo CRM; o Marketing responde na Meta. */
export interface SocialCommentReplyPayload {
  clientAccountId: string
  channel: 'facebook' | 'instagram'
  /** externalId do comentário (o mesmo do `social.engagement.captured`). */
  commentId: string
  text: string
  /** id da SocialCommentReply do CRM: o Marketing deduplica por ele e devolve no `social.comment.replied`. */
  requestId: string
}

export interface LeadOutcomeInput {
  leadId: string
  contactPhone?: string | null
  /** Canal da conversa do lead (painel do Marketing compara custo/qualidade por canal). Opcional. */
  sourceChannel?: 'facebook' | 'instagram' | 'whatsapp' | null
  /** Anúncio de origem (id do anúncio da Meta). Opcional. */
  sourceAdId?: string | null
  /** Jornada do lead no funil (leadOutcome.ts → montarJornada). Opcional; só vai quando combinado com o Marketing. */
  journey?: Record<string, unknown> | null
}

export interface LeadWonInput extends LeadOutcomeInput {
  /** Valor da venda em reais (Lead.value do Prisma — já é reais, não centavos). */
  valueReais: number
}

export type FunnelLevel = 'top' | 'middle' | 'bottom'

/** `lead.stage.reached` (combinado com o Marketing, 15/11/2026): o nível vem da coluna `Stage.funnelLevel`. */
export interface LeadStageReachedInput {
  leadId: string
  funnelLevel: FunnelLevel
  stageName: string
  sourceChannel?: 'facebook' | 'instagram' | 'whatsapp' | null
  sourceAdId?: string | null
}

export interface CrmNervo {
  /** Melhor esforço: NUNCA lança. A troca de estágio no banco já aconteceu antes desta chamada. */
  publishLeadWon(input: LeadWonInput): Promise<void>
  /** Melhor esforço: NUNCA lança. */
  publishLeadLost(input: LeadOutcomeInput): Promise<void>
  /** Lead qualificado (uma vez por lead). NUNCA lança: `queued`, `unpaired` (CRM não conectado) ou `error`. */
  publishLeadQualified(input: LeadOutcomeInput): Promise<'queued' | 'unpaired' | 'error'>
  /** Lead chegou num NÍVEL do funil (topo/meio/fim), uma vez por nível por lead. NUNCA lança. */
  publishLeadStageReached(input: LeadStageReachedInput): Promise<'queued' | 'unpaired' | 'error'>
  /** Registra um handler pra um evento que o Mind entrega (ex.: `social.engagement.captured`). */
  on(type: string, handler: EventHandler): void
  /** Ponto de entrada do que o Mind entrega — ligue à rota HTTP de inbound deste CRM. */
  receive(req: InboundRequest): Promise<InboundResponse>
  /**
   * Pede ao Marketing para entregar uma resposta na Meta. NUNCA lança: `queued` (sai assim que der — a caixa
   * de saída é durável), `unpaired` (CRM ainda não conectado ao Mind: a resposta NÃO sai) ou `error`.
   */
  publishSocialMessageSend(payload: SocialMessageSendPayload): Promise<'queued' | 'unpaired' | 'error'>
  /** Pede ao Marketing para RESPONDER um comentário (`social.comment.reply`). Mesmas garantias do envio de DM. */
  publishSocialCommentReply(payload: SocialCommentReplyPayload): Promise<'queued' | 'unpaired' | 'error'>
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
      provides: { events: [{ type: 'lead.stage.reached' }, { type: 'lead.qualified' },{ type: 'lead.won' }, { type: 'lead.lost' }, { type: 'social.message.send' }, { type: 'social.comment.reply' }] },
      seal: { secrets: config.sealSecrets },
      timeoutMs: 8_000,
      retries: 1,
      breakerThreshold: 0,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      log,
    })

  /** Publica um pedido ao Marketing (resposta de DM ou de comentário). Nunca lança. */
  async function pedir(type: string, payload: object, requestId: string): Promise<'queued' | 'unpaired' | 'error'> {
    try {
      await connection.publish(type, payload, { correlationId: requestId })
      return 'queued'
    } catch (error) {
      if (isNervoError(error) && error.code === 'NERVO_UNPAIRED') {
        log('warn', `Nervo: ${type} NÃO enviado — o CRM não está conectado ao Mind`, { requestId })
        return 'unpaired'
      }
      log('error', `Nervo: falha ao enfileirar ${type}`, { error: errorText(error), requestId })
      return 'error'
    }
  }

  async function publish(type: 'lead.qualified' | 'lead.won' | 'lead.lost', input: LeadOutcomeInput, valueCents: number | undefined): Promise<'queued' | 'unpaired' | 'error'> {
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
          ...(input.sourceChannel ? { sourceChannel: input.sourceChannel } : {}),
          ...(input.sourceAdId ? { sourceAdId: input.sourceAdId } : {}),
          ...(input.journey ? { journey: input.journey } : {}),
        },
        { correlationId: `${input.leadId}:${type}` },
      )
      return 'queued'
    } catch (error) {
      if (isNervoError(error) && error.code === 'NERVO_UNPAIRED') {
        // Esperado enquanto o dono não aceitou o pedido no Mind (ou depois de uma revogação): a peça não enfileira sem tenant.
        log('info', `Nervo: ${type} não enviado porque o CRM ainda não está conectado ao Mind (o lead já foi movido aqui)`, { leadId: input.leadId })
        return 'unpaired'
      }
      log('warn', `Nervo: não consegui publicar ${type} (o lead já foi movido no CRM; o evento não foi enviado)`, { error: errorText(error), leadId: input.leadId })
      return 'error'
    }
  }

  return {
    publishLeadWon: async (input) => { await publish('lead.won', input, Math.round(input.valueReais * 100)) },
    publishLeadLost: async (input) => { await publish('lead.lost', input, undefined) },
    publishLeadQualified: (input) => publish('lead.qualified', input, undefined),
    publishLeadStageReached: async (input) => {
      await connection.advance().catch(() => undefined)
      return pedir('lead.stage.reached', {
        clientAccountId: config.mindMarketingClientAccountId,
        leadId: input.leadId,
        occurredAt: new Date().toISOString(),
        funnelLevel: input.funnelLevel,
        stageName: input.stageName.trim().slice(0, 80),
        ...(input.sourceChannel ? { sourceChannel: input.sourceChannel } : {}),
        ...(input.sourceAdId ? { sourceAdId: input.sourceAdId } : {}),
      }, `${input.leadId}:stage.${input.funnelLevel}`)
    },
    on: (type, handler) => connection.on(type, handler),
    receive: (req) => connection.receive(req),
    publishSocialMessageSend: (payload) => pedir('social.message.send', payload, payload.requestId),
    publishSocialCommentReply: (payload) => pedir('social.comment.reply', payload, payload.requestId),
    status: async () => (connection.status ? connection.status().catch(() => undefined) : undefined),
    advance: async (restart) => connection.advance(restart ? { restart: true } : undefined).catch(() => undefined),
    tick: async () => {
      if (connection.tick) await connection.tick().catch((e: unknown) => log('warn', 'Nervo: tick falhou', { error: errorText(e) }))
    },
  }
}
