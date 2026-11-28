// 🤖 A IA responde sozinha os comentários NOVOS do Facebook/Instagram (dono, 28/11/2026: "queria que a IA
// respondesse os comentários, o que não está fazendo"). Antes só o atendente respondia pela tela Comentários.
// Regras: resposta PÚBLICA curta, sem preço/valor, sem pedir dado pessoal; quem tem interesse é chamado para o
// WhatsApp (Facebook: link; Instagram: link não é clicável no comentário → chama no direct). Ofensa, spam,
// reclamação ou assunto fora do solar → a IA NÃO responde (fica para o atendente na tela Comentários).
// Desligar: SystemConfig `ia_responde_comentarios` = "off".
import 'server-only'
import { prisma } from '@/lib/prisma'

export type DecisaoComentario = { responder: boolean; texto: string }

const LINK_WHATS = 'https://wa.me/552120276013'

export function promptComentario(channel: 'facebook' | 'instagram'): string {
  const convite = channel === 'facebook'
    ? `Para quem tem interesse, convide para o WhatsApp com este link: ${LINK_WHATS}`
    : 'Para quem tem interesse, peça para chamar no direct (no Instagram o link no comentário não abre).'
  return [
    'Você é a atendente da KeroSolar (energia solar no Rio de Janeiro: projeto, instalação, homologação e financiamento).',
    `Responda um COMENTÁRIO PÚBLICO num post/anúncio do ${channel === 'facebook' ? 'Facebook' : 'Instagram'}.`,
    'Regras:',
    '- Português do Brasil, simpática, no máximo 2 frases curtas, no máximo 1 emoji.',
    '- Use o primeiro nome da pessoa se souber.',
    '- NUNCA diga preço, valor, parcela, desconto ou prazo em público. NUNCA peça telefone, conta de luz ou endereço no comentário.',
    `- ${convite}`,
    '- Pergunta geral sobre energia solar: responda em uma frase simples e convide para continuar no privado.',
    '- Elogio ou "quero"/"interesse"/"valor?"/"quanto custa": agradeça e convide para o privado.',
    '- NÃO responda (responder=false) se for: ofensa, xingamento, spam, propaganda de outra empresa, reclamação séria, assunto que não tem a ver com energia solar, ou só marcação de amigo sem texto.',
    'Devolva SÓ um JSON: {"responder": true|false, "texto": "resposta"}',
  ].join('\n')
}

/** Comentário que nem vale chamar a IA (vazio, só marcações/emoji, ou da própria página). */
export function ignorarComentario(texto: string, autor?: string | null): boolean {
  if (autor && /kero\s*solar/i.test(autor)) return true
  const semMarcacao = (texto || '').replace(/@[\w.]+/g, '').replace(/[^\p{L}\p{N}]/gu, '')
  return semMarcacao.length < 2
}

export function lerDecisao(bruto: string): DecisaoComentario | null {
  const m = /\{[\s\S]*\}/.exec(bruto || '')
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { responder?: unknown; texto?: unknown }
    // link puro (a IA às vezes devolve "[https://...]" ou "(https://...)")
    const texto = typeof j.texto === 'string' ? j.texto.trim().replace(/[[(](https?:\/\/[^\])\s]+)[\])]/g, '$1') : ''
    if (j.responder !== true || !texto) return { responder: false, texto: '' }
    // trava de segurança: nunca valor em público
    if (/r\$\s*\d|\d+\s*(mil|reais)|parcela/i.test(texto)) return { responder: false, texto: '' }
    return { responder: true, texto: texto.slice(0, 600) }
  } catch { return null }
}

/** Gera e publica a resposta da IA para um comentário novo. Nunca lança. */
export async function responderComentarioComIa(externalId: string): Promise<void> {
  try {
    const liga = await prisma.systemConfig.findUnique({ where: { key: 'ia_responde_comentarios' } })
    if (liga?.value === 'off') return
    const eng = await prisma.socialEngagement.findUnique({
      where: { externalId },
      select: { id: true, kind: true, channel: true, text: true, authorName: true, _count: { select: { replies: true } } },
    })
    if (!eng || eng.kind !== 'comment' || eng._count.replies > 0) return
    if (eng.channel !== 'facebook' && eng.channel !== 'instagram') return
    if (ignorarComentario(eng.text, eng.authorName)) return
    const { loadAiConfig, chat } = await import('@/lib/crm/ai')
    const cfg = await loadAiConfig()
    if (!cfg.provider) return
    const bruto = await chat(cfg, promptComentario(eng.channel), [
      { role: 'user', content: `Autor: ${eng.authorName || 'desconhecido'}\nComentário: ${eng.text}` },
    ], 300, true)
    const d = lerDecisao(bruto)
    if (!d?.responder) {
      console.log('[comentario ia] não respondeu (fica para o atendente): %s', eng.text.slice(0, 80))
      return
    }
    const { responderComentario } = await import('./commentReplies')
    const r = await responderComentario(eng.id, d.texto)
    console.log('[comentario ia] %s: %s', r.ok ? 'respondido' : `falhou (${r.erro})`, d.texto.slice(0, 80))
  } catch (e) {
    console.error('[comentario ia] erro (ignorado):', e)
  }
}
