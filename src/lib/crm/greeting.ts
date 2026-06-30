import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * 🎯 SAUDAÇÃO DINÂMICA COM APRENDIZADO (teste A/B + bandit ε-greedy).
 *
 * Em vez de uma saudação fixa, mantemos N variações. O sistema:
 *  1) testa todas igualmente até cada uma ter amostra mínima (explora);
 *  2) depois passa a usar mais a que MAIS faz o cliente RESPONDER (explora 20% / usa 80%).
 *
 * "Resultado" = o cliente respondeu a saudação (sair do silêncio é o trabalho da saudação).
 * As estatísticas e as variações ficam em systemConfig (sem mexer no schema do banco).
 *
 * Marcamos em lead.customFields:
 *  - greetingVariant: id da variação enviada
 *  - greetingCounted: já contabilizamos a resposta dela? (idempotência)
 */

export type Variant = { id: string; text: string; enabled?: boolean }
type Stat = { sent: number; replied: number }
type Stats = Record<string, Stat>

const CFG_VARIANTS = 'welcome_variants'
const CFG_STATS = 'welcome_stats'

const MIN_SAMPLES = 12 // até cada variação ter isso de envios, faz rodízio (explora todas)
const EPSILON = 0.2    // depois: 20% testa outra à toa, 80% usa a campeã

/** Variações padrão — todas terminam com a PERGUNTA fácil (conta + economia). */
export const DEFAULT_VARIANTS: Variant[] = [
  {
    id: 'economia',
    enabled: true,
    text:
      '{SAUDACAO}, {nome}! Aqui é da KeroSolar ☀️ Posso te mostrar agora quanto você economizaria trocando sua energia por solar. ' +
      'Me diz só quanto vem sua conta de luz por mês (em R$) que já te passo a simulação! 💡',
  },
  {
    id: 'conta',
    enabled: true,
    text:
      '{SAUDACAO}, {nome}! Obrigada pelo contato com a KeroSolar 😊 Pra eu já preparar seu orçamento de energia solar, ' +
      'me envia a *foto da sua conta de luz* — ou, se preferir, me diz seu *consumo médio em kWh* ou o *valor médio da conta em reais*. Qualquer um já serve!',
  },
  {
    id: 'pergunta',
    enabled: true,
    text:
      '{SAUDACAO}, {nome}! Tudo bem? 🌞 Quer ver quanto dá pra reduzir na sua conta de luz com energia solar? ' +
      'Me fala só o valor que costuma vir por mês que eu já te mostro o quanto você economiza.',
  },
]

/** Lê TODAS as variações cadastradas (ou os padrões), inclusive as desativadas — para a tela de edição. */
export async function getVariantsRaw(): Promise<Variant[]> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CFG_VARIANTS } })
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value)
      if (Array.isArray(parsed) && parsed.length) {
        const list = parsed
          .filter((v) => v && typeof v.id === 'string' && typeof v.text === 'string')
          .map((v) => ({ id: v.id, text: v.text, enabled: v.enabled !== false }))
        if (list.length) return list
      }
    } catch { /* usa padrão */ }
  }
  return DEFAULT_VARIANTS
}

/** Lê as variações que valem para o envio: só as habilitadas e com texto. */
export async function getVariants(): Promise<Variant[]> {
  const ativas = (await getVariantsRaw()).filter((v) => v.enabled !== false && v.text.trim())
  return ativas.length ? ativas : DEFAULT_VARIANTS
}

async function getStats(): Promise<Stats> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CFG_STATS } })
  if (!row?.value) return {}
  try {
    const o = JSON.parse(row.value)
    return o && typeof o === 'object' ? (o as Stats) : {}
  } catch { return {} }
}

async function saveStats(stats: Stats) {
  await prisma.systemConfig.upsert({
    where: { key: CFG_STATS },
    update: { value: JSON.stringify(stats) },
    create: { key: CFG_STATS, value: JSON.stringify(stats) },
  })
}

// 🔒 GARANTIA: toda saudação SEMPRE pede a conta de luz — é o que mais faz o cliente responder.
// Se a variação (sorteada ou editada) não pedir conta/kWh/fatura, completamos com esta linha.
const PEDIDO_CONTA =
  'Me envia a *foto da sua conta de luz* — ou só me diz seu *consumo em kWh* ou o *valor médio da conta* — que eu já te mostro quanto você economiza! ⚡'

function pedeConta(text: string): boolean {
  return /\bconta\b|\bkwh\b|\bfatura\b/i.test(text.normalize('NFD').replace(/[̀-ͯ]/g, ''))
}

/** Troca os placeholders, limpa sobras e garante que a saudação peça a conta. */
export function montarTexto(text: string, saud: string, nome: string): string {
  let t = text
    .replace(/\{SAUDACAO\}/gi, saud)
    .replace(/\{nome\}/gi, nome || '')
    .replace(/\s+,/g, ',')      // " ," → ","
    .replace(/,\s*([!?.])/g, '$1') // "Boa tarde, !" → "Boa tarde!"
    .replace(/\s+([!?.])/g, '$1')  // " !" → "!"
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!pedeConta(t)) t = `${t}\n\n${PEDIDO_CONTA}`
  return t
}

/**
 * Escolhe a variação a enviar (bandit ε-greedy) e contabiliza o ENVIO.
 * Marca o lead com a variação escolhida. Retorna o TEXTO pronto (placeholders trocados).
 */
export async function escolherSaudacao(leadId: string, saud: string, nome: string): Promise<{ id: string; text: string }> {
  const variants = await getVariants()
  const stats = await getStats()

  let escolhida: Variant
  const semAmostra = variants.filter((v) => (stats[v.id]?.sent ?? 0) < MIN_SAMPLES)
  if (semAmostra.length) {
    // Explora: usa a MENOS enviada (rodízio equilibrado entre as que ainda têm pouca amostra)
    escolhida = semAmostra.reduce((a, b) => ((stats[a.id]?.sent ?? 0) <= (stats[b.id]?.sent ?? 0) ? a : b))
  } else if (Math.random() < EPSILON) {
    // Explora: uma à toa
    escolhida = variants[Math.floor(Math.random() * variants.length)]
  } else {
    // Usa a campeã: maior taxa de resposta (replied/sent)
    escolhida = variants.reduce((a, b) => (taxa(stats[a.id]) >= taxa(stats[b.id]) ? a : b))
  }

  // Contabiliza o envio
  const s = stats[escolhida.id] ?? { sent: 0, replied: 0 }
  stats[escolhida.id] = { sent: s.sent + 1, replied: s.replied }
  await saveStats(stats)

  // Marca o lead (sem perder os customFields existentes)
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
    const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
    await prisma.lead.update({
      where: { id: leadId },
      data: { customFields: { ...cf, greetingVariant: escolhida.id, greetingCounted: false } as object },
    })
  } catch { /* não bloqueia o envio */ }

  return { id: escolhida.id, text: montarTexto(escolhida.text, saud, nome) }
}

/** Contabiliza a RESPOSTA do cliente à saudação (idempotente — conta só 1x por lead). */
export async function registrarResposta(leadId: string): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
    const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
    const vid = cf.greetingVariant as string | undefined
    if (!vid || cf.greetingCounted) return
    const stats = await getStats()
    const s = stats[vid] ?? { sent: 0, replied: 0 }
    stats[vid] = { sent: s.sent, replied: s.replied + 1 }
    await saveStats(stats)
    await prisma.lead.update({
      where: { id: leadId },
      data: { customFields: { ...cf, greetingCounted: true } as object },
    })
  } catch { /* silencioso */ }
}

function taxa(s?: Stat): number {
  if (!s || s.sent === 0) return 0
  return s.replied / s.sent
}

/** Placar para a tela de Configurações: variação, enviadas, responderam, %. */
export async function placarSaudacoes(): Promise<Array<{ id: string; sent: number; replied: number; rate: number }>> {
  const variants = await getVariantsRaw()
  const stats = await getStats()
  return variants.map((v) => {
    const s = stats[v.id] ?? { sent: 0, replied: 0 }
    return { id: v.id, sent: s.sent, replied: s.replied, rate: taxa(s) }
  })
}
