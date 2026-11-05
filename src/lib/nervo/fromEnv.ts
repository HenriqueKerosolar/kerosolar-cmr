// Monta o Nervo deste CRM a partir do ambiente (uma vez por processo). Chamado pelo hook de mudança de
// estágio (moveLeadStage). `undefined` quando o Nervo está desligado (sem NERVO_BASE_URL) ou incompleto
// — nunca lança, nunca impede o resto do CRM de funcionar.
import 'server-only'
import { prisma } from '@/lib/prisma'
import { createCrmNervo, type CrmNervo } from './crmNervo'
import { loadNervoConfig } from './config'
import { createPrismaQuery } from './prismaQuery'

type Log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void

const log: Log = (level, message, meta) => console[level === 'info' ? 'log' : level](`[nervo] ${message}`, meta ?? '')

const globalForNervo = globalThis as unknown as { crmNervo?: CrmNervo | null }

export function getCrmNervo(): CrmNervo | undefined {
  if (globalForNervo.crmNervo !== undefined) return globalForNervo.crmNervo ?? undefined

  const result = loadNervoConfig(process.env, { publicAppUrl: process.env.NEXT_PUBLIC_APP_URL, sealSecret: process.env.SESSION_SECRET })
  if (result.status === 'disabled') {
    globalForNervo.crmNervo = null
    return undefined
  }
  if (result.status === 'incomplete') {
    log('warn', `Nervo desligado: faltam ou estão inválidas as variáveis ${result.missing.join(', ')}`)
    globalForNervo.crmNervo = null
    return undefined
  }
  try {
    globalForNervo.crmNervo = createCrmNervo({ config: result.config, query: createPrismaQuery(prisma), log })
  } catch (error) {
    log('warn', `Nervo desligado: a configuração foi recusada (${error instanceof Error ? error.message : String(error)})`)
    globalForNervo.crmNervo = null
  }
  return globalForNervo.crmNervo ?? undefined
}
