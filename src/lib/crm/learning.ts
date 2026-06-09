import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadAiConfig, embedText, cosineSim } from './ai'

// Respostas curtas/genéricas que NÃO valem como conhecimento
const GENERICA = /^(ok|okay|blz|beleza|bom dia|boa tarde|boa noite|ola|olá|oi|obrigad|valeu|de nada|sim|nao|não|certo|perfeito|otimo|ótimo|combinado|isso|isso mesmo|👍|😊)\b/i

/**
 * Aprende com a resposta do operador: pega a última PERGUNTA do cliente nesta conversa
 * e guarda o par pergunta→resposta na base de conhecimento (com embedding pra busca).
 * Silencioso: nunca lança erro (não pode atrapalhar o atendimento).
 */
export async function aprenderResposta(conversationId: string, answer: string): Promise<void> {
  try {
    const resp = (answer ?? '').trim()
    if (resp.length < 8 || GENERICA.test(resp)) return  // resposta curta/genérica → não aprende

    // última mensagem RECEBIDA do cliente (a "pergunta")
    const pergunta = await prisma.message.findFirst({
      where: { conversationId, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    const q = (pergunta?.content ?? '').trim()
    if (q.length < 6 || /^(📷|📄|📎|🎤|🎥|\[)/.test(q)) return  // sem pergunta de texto válida → não aprende

    // evita duplicar o mesmo par
    const existe = await prisma.learnedAnswer.findFirst({ where: { question: q, answer: resp }, select: { id: true } })
    if (existe) return

    const cfg = await loadAiConfig()
    const embedding = await embedText(cfg, q)
    await prisma.learnedAnswer.create({ data: { question: q, answer: resp, embedding: embedding ?? undefined } })
  } catch (e) {
    console.error('[learning aprender]', e)
  }
}

/**
 * Busca na base de conhecimento as respostas mais PARECIDAS com a mensagem do cliente.
 * Retorna um texto pronto pra injetar no prompt da IA (ou '' se não houver nada relevante).
 */
export async function buscarConhecimento(text: string): Promise<string> {
  try {
    const q = (text ?? '').trim()
    if (q.length < 4) return ''
    const cfg = await loadAiConfig()
    const alvo = await embedText(cfg, q)
    if (!alvo) return ''

    const base = await prisma.learnedAnswer.findMany({
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { id: true, question: true, answer: true, embedding: true },
    })
    const scored = base
      .map((r) => ({ r, sim: Array.isArray(r.embedding) ? cosineSim(alvo, r.embedding as number[]) : 0 }))
      .filter((x) => x.sim >= 0.82)        // só o que é REALMENTE parecido
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
    if (!scored.length) return ''

    // marca uso (não bloqueante)
    prisma.learnedAnswer.updateMany({ where: { id: { in: scored.map((x) => x.r.id) } }, data: { useCount: { increment: 1 } } }).catch(() => {})

    const itens = scored.map((x, i) => `${i + 1}. Cliente perguntou: "${x.r.question}"\n   Resposta dada pela equipe: "${x.r.answer}"`).join('\n')
    return itens
  } catch (e) {
    console.error('[learning buscar]', e)
    return ''
  }
}
