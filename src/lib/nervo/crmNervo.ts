// Este CRM como sistema do ecossistema (Nervo): publica o desfecho comercial do lead (lead.won / lead.lost)
// para o Mind Marketing, que já assina esses eventos e grava como conversão real (receita de verdade —
// hoje toda venda aparece "sem atribuição" do lado do Marketing). Tudo passa pelo Nervo Central (o Mind);
// nada de conector avulso. `lead.qualified` fica de fora: não há estágio "isQualified" no schema deste CRM.
//
// Pareamento automático (igual ao Mind Marketing): a única configuração é o endereço do Mind
// (NERVO_BASE_URL). O dono aceita UM pedido no painel do Mind e a credencial (Key, tenant, segredo de
// entrega) chega direto a este CRM, que a guarda cifrada no próprio banco (tabela `nervo_connection`).
//
// Durabilidade: a CONEXÃO pareada é durável em Postgres (`createPostgresConnectionStore`) — sem isso,
// cada deploy no Railway (que reinicia o processo) forçaria o dono a aceitar o pareamento de novo. A
// caixa de SAÍDA dos eventos fica em memória (padrão da peça): aceitável aqui porque `publish()` já
// tenta o envio na hora (`sendNow` padrão) e, falhando, é melhor esforço — a troca de estágio já
// aconteceu no banco antes disso e nunca é desfeita por uma falha do Nervo.
import { createNervoConnection, createPostgresConnectionStore, isNervoError, redact, type Connection, type FetchLike, type PgQuery } from '@lib/nervo'
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
  /** Injetável nos testes (só usamos `publish`/`advance`). Padrão: `createNervoConnection` de verdade. */
  connection?: Pick<Connection, 'publish' | 'advance'>
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
  }
}
