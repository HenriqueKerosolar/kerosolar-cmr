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
import { montarJornada, type DadosJornada, type Jornada } from './jornada'

const ORIGENS = ['facebook', 'instagram', 'whatsapp'] as const

/** A jornada só vai quando o Marketing confirmou que aceita o campo (chave NERVO_SEND_JOURNEY=1 no Railway). */
export function jornadaLigada(): boolean {
  return process.env.NERVO_SEND_JOURNEY === '1'
}

/** Lê do banco o que a jornada precisa e monta (jornada.ts). Melhor esforço: erro → sem jornada. */
async function lerJornada(leadId: string, lead: { createdAt: Date; stageId: string; customFields: unknown; contact: { customFields: unknown } | null }, fechadoEm: Date | null): Promise<Jornada | null> {
  try {
    const [notas, mensagens, etapa] = await Promise.all([
      prisma.note.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' }, select: { content: true, createdAt: true }, take: 500 }),
      prisma.message.findMany({ where: { conversation: { leadId } }, orderBy: { createdAt: 'asc' }, select: { direction: true, senderType: true, content: true, createdAt: true }, take: 2000 }),
      prisma.stage.findUnique({ where: { id: lead.stageId }, select: { name: true } }),
    ])
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    const convite = ((lead.contact?.customFields as Record<string, unknown> | null)?.conviteWhats ?? null) as DadosJornada['convite']
    return montarJornada({
      notas, mensagens, etapaAtual: etapa?.name ?? null, leadCriadoEm: lead.createdAt,
      qualificadoEm: typeof cf.qualificadoEm === 'string' ? cf.qualificadoEm : null, convite, leadId,
    }, fechadoEm)
  } catch (e) {
    console.error('[nervo] montar jornada falhou (segue sem ela):', e)
    return null
  }
}

/**
 * Campos comuns do desfecho: telefone, canal de ORIGEM do lead, anúncio de origem e (quando ligada) a
 * jornada. `fechadoEm` = momento da venda ganha/perdida (null no lead.qualified).
 */
export async function montarDesfecho(leadId: string, fechadoEm: Date | null = null): Promise<{ input: LeadOutcomeInput; value: number } | null> {
  const full = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  if (!full) return null
  const journey = jornadaLigada() ? await lerJornada(leadId, full, fechadoEm) : null
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
      ...(journey ? { journey: journey as unknown as Record<string, unknown> } : {}),
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
 * Venda ganha de quem veio de ANÚNCIO DE WHATSAPP (CTWA: o CRM tem o `ctwaClid` do clique) → Purchase na
 * Conversions API da Meta, uma vez por lead. As vendas de Messenger/Instagram vão pelo Mind Marketing (dona
 * da conexão com a Meta) usando o MESMO event_id `<leadId>:purchase` — se as duas pontas mandarem, a Meta
 * conta uma vez só. Decisão do dono (15/11/2026): mandar as vendas para a Meta.
 */
async function compraParaMetaCtwa(leadId: string): Promise<void> {
  try {
    const full = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: true, conversations: { where: { channel: 'whatsapp' }, include: { account: true }, take: 1 } },
    })
    const cf = (full?.customFields as Record<string, unknown> | null) ?? {}
    const clid = (full?.contact as { ctwaClid?: string | null } | null)?.ctwaClid ?? null
    if (!full || !clid || cf.compraMetaEnviadaEm) return
    const { sendCapiEvent } = await import('@/lib/crm/capi')
    const ok = await sendCapiEvent({
      eventName: 'Purchase', ctwaClid: clid, wabaId: full.conversations[0]?.account?.cloudWabaId ?? null,
      value: full.value || 0, currency: 'BRL', phone: full.contact?.phone ?? null, eventId: `${leadId}:purchase`,
    })
    if (ok) await marcar(leadId, 'compraMetaEnviadaEm')
  } catch (e) {
    console.error('[capi] purchase da venda ganha falhou (ignorado):', e)
  }
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
    if (stage.isWon) await compraParaMetaCtwa(leadId)
    const campo = stage.isWon ? 'vendaGanhaEnviadaEm' : 'vendaPerdidaEnviadaEm'
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
    if ((lead?.customFields as Record<string, unknown> | null)?.[campo]) return
    const { getCrmNervo } = await import('./fromEnv')
    const nervo = getCrmNervo()
    if (!nervo) return
    const desfecho = await montarDesfecho(leadId, new Date())
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
