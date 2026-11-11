import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadAiConfig, embedText, cosineSim, chat, extractJson, type AiConfig } from './ai'

// REGRA DO DONO (2026-11-05): só vira aprendizado o que a IA NÃO soube responder, ou quando o
// atendente CORRIGE uma resposta errada da IA. Conversa normal NÃO é guardada.
const SYSTEM_AVALIA = `Você decide se a mensagem de um atendente humano (empresa de ENERGIA SOLAR) deve virar APRENDIZADO para a IA de atendimento.
Recebe o trecho recente da conversa (CLIENTE, IA e ATENDENTE) e a nova mensagem do ATENDENTE.
"util" = true SOMENTE em um destes dois casos:
 (A) NAO_SOUBE: o cliente fez uma pergunta/dúvida que a IA NÃO respondeu (não respondeu nada, disse que não entendeu, que o consultor confirma, ou desconversou) e o atendente trouxe a resposta com a informação.
 (B) CORRECAO: a IA respondeu ERRADO ou incompleto e o atendente CORRIGIU / deu a informação certa.
"util" = false para tudo o mais: conversa normal, saudação, agradecimento, combinar horário, pedir documento/foto, status de um caso particular daquele cliente, valor/orçamento específico, dado pessoal, assunto com fornecedor/parceiro, ou quando a IA já tinha respondido certo.
"pergunta" = a dúvida do cliente, reescrita curta e clara (em português), de forma que sirva para outros clientes.
"resposta" = a informação correta do atendente, reescrita de forma geral (sem nome nem dado do cliente), mantendo os fatos.
Responda SOMENTE com JSON: {"util": true|false, "caso": "NAO_SOUBE"|"CORRECAO"|"", "pergunta": "...", "resposta": "...", "motivo": "..."}`

/** Usa a IA para decidir se a mensagem do atendente vale como aprendizado (não soube / correção). */
export async function avaliarPar(cfg: AiConfig, trecho: string, resposta: string): Promise<{ util: boolean; caso: string; pergunta: string; resposta: string; motivo: string }> {
  const out = await chat(cfg, SYSTEM_AVALIA, [{ role: 'user', content:
    `Trecho recente da conversa (do mais antigo para o mais recente):\n${trecho}\n\nNova mensagem do ATENDENTE:\n${resposta}` }], 400, true)
  const j = extractJson<{ util?: boolean; caso?: string; pergunta?: string; resposta?: string; motivo?: string }>(out)
  return { util: j?.util === true, caso: (j?.caso ?? '').trim(), pergunta: (j?.pergunta ?? '').trim(), resposta: (j?.resposta ?? '').trim(), motivo: (j?.motivo ?? '').trim() }
}

// Respostas curtas/genéricas que NÃO valem como conhecimento
const GENERICA = /^(ok|okay|blz|beleza|bom dia|boa tarde|boa noite|ola|olá|oi|obrigad|valeu|de nada|sim|nao|não|certo|perfeito|otimo|ótimo|combinado|isso|isso mesmo|👍|😊)\b/i

/**
 * Aprende com a resposta do operador SOMENTE quando a IA não soube responder ou errou
 * (o atendente corrigiu). Guarda o par pergunta→resposta (com embedding pra busca).
 * Silencioso: nunca lança erro (não pode atrapalhar o atendimento).
 */
export async function aprenderResposta(conversationId: string, answer: string): Promise<void> {
  try {
    const resp = (answer ?? '').trim()
    if (resp.length < 8 || GENERICA.test(resp)) return  // resposta curta/genérica → não aprende

    // dado pessoal na resposta (telefone, e-mail, CPF) → nunca vira conhecimento
    if (/\b\d{10,13}\b|\(\d{2}\)\s?\d{4,5}-?\d{4}|@\w+\.\w+|\d{3}\.\d{3}\.\d{3}-\d{2}/.test(resp)) return

    // trecho recente da conversa (cliente, IA, atendente) — sem a própria mensagem que acabou de ser enviada
    const recentes = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { direction: true, senderType: true, content: true },
    })
    const idxPropria = recentes.findIndex((m) => m.direction === 'outbound' && (m.content ?? '').trim() === resp)
    const antes = (idxPropria >= 0 ? recentes.slice(idxPropria + 1) : recentes).reverse()
    // precisa haver uma mensagem de TEXTO do cliente no trecho (a dúvida)
    if (!antes.some((m) => m.direction === 'inbound' && (m.content ?? '').trim().length >= 3 && !/^(📷|📄|📎|🎤|🎥|\[)/.test((m.content ?? '').trim()))) return
    const trecho = antes.map((m) => {
      const quem = m.direction === 'inbound' ? 'CLIENTE' : m.senderType === 'human' ? 'ATENDENTE' : 'IA'
      return `${quem}: ${(m.content ?? '').trim().slice(0, 600)}`
    }).join('\n')

    // 🧠 só aprende se a IA NÃO soube responder ou se o atendente CORRIGIU a IA
    const cfg = await loadAiConfig()
    const av = await avaliarPar(cfg, trecho, resp)
    if (!av.util || av.pergunta.length < 6) { console.log('[learning] não aprendeu: %s', av.motivo || 'conversa normal'); return }
    const q = av.pergunta
    const a = av.resposta.length >= 8 ? av.resposta : resp
    console.log('[learning] aprendeu (%s): %s', av.caso || '?', q)

    // evita duplicar o mesmo par
    const existe = await prisma.learnedAnswer.findFirst({ where: { question: q, answer: a }, select: { id: true } })
    if (existe) return

    const embedding = await embedText(cfg, q)
    await prisma.learnedAnswer.create({ data: { question: q, answer: a, embedding: embedding ?? undefined } })
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
