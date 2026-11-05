// Configuração do Nervo neste CRM. DESLIGADO por padrão: sem NERVO_BASE_URL nada muda no sistema.
//
// Só o modo PAREADO existe aqui (igual ao Mind Marketing): a única configuração é o endereço do Mind
// (NERVO_BASE_URL). O dono aceita UM pedido no painel do Mind e a credencial chega direto ao banco
// deste CRM, selada com o SESSION_SECRET que o projeto já tem — ninguém copia Key nem segredo no Railway.

export type NervoEnvironment = 'development' | 'sandbox' | 'staging' | 'production'

export interface NervoConfig {
  /** Endereço do Mind (https). */
  baseUrl: string
  installationId: string
  environment: NervoEnvironment
  /** URL pública onde o Mind entrega eventos/chamadas a este CRM (é o que o dono confere ao aceitar). */
  inboundUrl: string
  /** Segredo-base (32+ caracteres) que sela a credencial pareada no banco: o SESSION_SECRET do projeto. */
  sealSecrets: string[]
  /** Workspace do Mind Marketing para onde publicamos lead.won/lead.lost (achado no painel do Mind). */
  mindMarketingClientAccountId: string
}

export type NervoConfigResult = { status: 'disabled' } | { status: 'incomplete'; missing: string[] } | { status: 'ready'; config: NervoConfig }

export interface LoadNervoConfigOptions {
  /** Origem pública do CRM: dela sai a URL de entrada quando NERVO_INBOUND_URL não é informada. */
  publicAppUrl?: string
  /** Segredo-base que sela a credencial pareada (o SESSION_SECRET). Nunca vem de uma variável nova. */
  sealSecret?: string
}

const ENVIRONMENTS: readonly string[] = ['development', 'sandbox', 'staging', 'production']
export const NERVO_INBOUND_PATH = '/api/public/nervo/inbound'
/** A peça recusa segredo-base menor que isto (HKDF não fortalece segredo fraco). */
export const NERVO_MIN_SEAL_SECRET_LENGTH = 32

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim()
  return v ? v : undefined
}

/**
 * `disabled`: NERVO_BASE_URL não definida (comportamento de sempre, nada do Nervo existe). `incomplete`:
 * o dono começou a configurar mas falta algo — o CRM segue funcionando SEM o Nervo (o motivo vai pro log,
 * nunca derruba a aplicação por causa de uma variável esquecida).
 */
export function loadNervoConfig(env: NodeJS.ProcessEnv = process.env, options: LoadNervoConfigOptions = {}): NervoConfigResult {
  const baseUrl = read(env, 'NERVO_BASE_URL')
  if (!baseUrl) return { status: 'disabled' }

  const inboundUrl = read(env, 'NERVO_INBOUND_URL') ?? (options.publicAppUrl ? `${options.publicAppUrl.replace(/\/+$/, '')}${NERVO_INBOUND_PATH}` : undefined)
  const environment = read(env, 'NERVO_ENVIRONMENT') ?? 'production'
  const installationId = read(env, 'NERVO_INSTALLATION_ID') ?? 'kerosolar-crm-prod'
  const mindMarketingClientAccountId = read(env, 'MIND_MARKETING_CLIENT_ACCOUNT_ID')

  const missing: string[] = []
  if (!inboundUrl) missing.push('NERVO_INBOUND_URL')
  if (!ENVIRONMENTS.includes(environment)) missing.push('NERVO_ENVIRONMENT (valor inválido)')
  if (!mindMarketingClientAccountId) missing.push('MIND_MARKETING_CLIENT_ACCOUNT_ID')

  const sealSecret = options.sealSecret
  if (!sealSecret || sealSecret.length < NERVO_MIN_SEAL_SECRET_LENGTH) missing.push(`SESSION_SECRET (precisa de ${NERVO_MIN_SEAL_SECRET_LENGTH}+ caracteres: é ele que sela a credencial do Nervo no banco)`)

  if (missing.length > 0 || !inboundUrl || !sealSecret || !mindMarketingClientAccountId) return { status: 'incomplete', missing }

  return {
    status: 'ready',
    config: {
      baseUrl,
      installationId,
      environment: environment as NervoEnvironment,
      inboundUrl,
      sealSecrets: [sealSecret],
      mindMarketingClientAccountId,
    },
  }
}
