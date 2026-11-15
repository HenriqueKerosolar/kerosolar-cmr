// Desfecho comercial do lead para o Mind Marketing (via Nervo): monta os campos comuns de lead.qualified /
// lead.won / lead.lost e decide quando um lead conta como QUALIFICADO.
//
// Regra do dono (15/11/2026, combinada com o Marketing): lead qualificado = o que PASSA da etapa
// "Financiamento pedido de documentos", ou seja, entra numa etapa de avanço depois dela (Financiamento
// Aprovado, Vistoria agendada, Fechou, Em homologação, Finalizado) ou numa etapa de venda ganha.
// Repescagem, "X dias depois", Leads adquiridos e "Já é cliente" ficam depois na ORDEM do funil, mas não
// são avanço, por isso nunca contam. Publica UMA vez por lead (marca `customFields.qualificadoEm`).
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { LeadOutcomeInput } from './crmNervo'

const ORIGENS = ['facebook', 'instagram', 'whatsapp'] as const

/** Campos comuns do desfecho: telefone, canal de ORIGEM do lead e anúncio de origem. */
export async function montarDesfecho(leadId: string): Promise<{ input: LeadOutcomeInput; value: number } | null> {
  const full = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  if (!full) return null
  // Canal de ORIGEM (quem veio do Instagram e fechou pelo WhatsApp conta para o Instagram); sem origem
  // conhecida, o canal da conversa mais recente.
  const origem = full.source && (ORIGENS as readonly string[]).includes(full.source) ? full.source : null
  const conv = origem ? null : await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' }, select: { channel: true } })
  const canal = origem ?? conv?.channel ?? null
  const sourceChannel = canal === 'facebook' || canal === 'instagram' || canal === 'whatsapp' ? canal : null
  const adId = (full.contact?.adReferral as { source_id?: unknown } | null)?.source_id
  return {
    value: full.value ?? 0,
    input: {
      leadId,
      contactPhone: full.contact?.phone ?? null,
      sourceChannel,
      sourceAdId: typeof adId === 'string' && adId.trim() ? adId.trim().slice(0, 128) : null,
    },
  }
}

type EtapaLite = { id: string; name: string; sortOrder: number; isWon: boolean; isLost: boolean }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** A etapa conta como "passou do financiamento"? (função pura — testável) */
export function etapaQualifica(etapa: EtapaLite, etapasDoFunil: EtapaLite[]): boolean {
  if (etapa.isLost) return false
  if (etapa.isWon) return true
  const fin = etapasDoFunil.find((s) => /financiamento pedido de documentos/.test(norm(s.name)))
  if (!fin || etapa.sortOrder <= fin.sortOrder) return false
  if (/repescagem|dias depois|adquirido|ja e cliente/.test(norm(etapa.name))) return false
  const fim = etapasDoFunil.find((s) => /^finalizado/.test(norm(s.name)))
  return !fim || etapa.sortOrder <= fim.sortOrder
}

/** Grava uma marca em `Lead.customFields` (relendo antes, para não apagar o que o motor gravou em paralelo). */
async function marcar(leadId: string, campo: string): Promise<void> {
  const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (atual?.customFields as Record<string, unknown> | null) ?? {}
  await prisma.lead.update({ where: { id: leadId }, data: { customFields: { ...cf, [campo]: new Date().toISOString() } as object } })
}

/**
 * Tudo o que o Marketing precisa saber quando o lead ENTRA numa etapa (chamado por `enterStage`, por onde
 * passam a troca manual, a IA e os fluxos): `lead.qualified` (uma vez), e `lead.won` / `lead.lost` quando a
 * etapa é de venda ganha / perdida — cada um UMA vez por lead (marcas em customFields), mesmo que o lead
 * saia e volte. Regra do dono (15/11/2026): chegou em "Fechou" (venda ganha) → avisa o Marketing na hora.
 * Melhor esforço: nunca lança.
 */
export async function publicarDesfechoAoEntrar(leadId: string, stageId: string): Promise<void> {
  await publicarQualificadoSePreciso(leadId, stageId)
  try {
    const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { isWon: true, isLost: true } })
    if (!stage?.isWon && !stage?.isLost) return
    const campo = stage.isWon ? 'vendaGanhaEnviadaEm' : 'vendaPerdidaEnviadaEm'
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
    if ((lead?.customFields as Record<string, unknown> | null)?.[campo]) return
    const { getCrmNervo } = await import('./fromEnv')
    const nervo = getCrmNervo()
    if (!nervo) return
    const desfecho = await montarDesfecho(leadId)
    if (!desfecho) return
    if (stage.isWon) await nervo.publishLeadWon({ ...desfecho.input, valueReais: desfecho.value })
    else await nervo.publishLeadLost(desfecho.input)
    await marcar(leadId, campo)
  } catch (e) {
    console.error('[nervo] desfecho do lead falhou (ignorado):', e)
  }
}

/**
 * Publica `lead.qualified` se o lead acabou de entrar numa etapa que qualifica e ainda não foi publicado.
 * Melhor esforço: nunca lança. Venda ganha também qualifica, então sai ANTES do `lead.won`.
 */
export async function publicarQualificadoSePreciso(leadId: string, stageId: string): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true, pipelineId: true } })
    if (!lead) return
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    if (cf.qualificadoEm) return
    const etapas = await prisma.stage.findMany({ where: { pipelineId: lead.pipelineId }, select: { id: true, name: true, sortOrder: true, isWon: true, isLost: true } })
    const etapa = etapas.find((s) => s.id === stageId)
    if (!etapa || !etapaQualifica(etapa, etapas)) return

    const { getCrmNervo } = await import('./fromEnv')
    const nervo = getCrmNervo()
    if (!nervo) return
    const desfecho = await montarDesfecho(leadId)
    if (!desfecho) return
    const r = await nervo.publishLeadQualified(desfecho.input)
    if (r !== 'queued') return // CRM não conectado ao Mind ou falha: tenta de novo na próxima troca de etapa
    await marcar(leadId, 'qualificadoEm')
    await prisma.note.create({ data: { leadId, type: 'system', content: `Lead qualificado (passou do financiamento ao entrar em "${etapa.name}") — enviado ao Mind Marketing.` } }).catch(() => {})
  } catch (e) {
    console.error('[nervo] lead.qualified falhou (ignorado):', e)
  }
}
