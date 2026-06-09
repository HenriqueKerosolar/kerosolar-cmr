import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadAiConfig, chat } from './ai'

/**
 * Gera uma mensagem de REENGAJAMENTO personalizada (Repescagem): usa a etapa de origem
 * e o contexto da conversa pra tentar trazer o cliente de volta — sempre muito educada,
 * mostrando gentilmente que a inação dele traz prejuízo. Retorna o texto, ou null se falhar.
 */
export async function gerarMensagemReengajamento(leadId: string, conversationId: string): Promise<string | null> {
  const cfg = await loadAiConfig()
  if (!cfg.provider) return null
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  if (!lead) return null
  const nome = lead.contact?.name?.split(' ')[0] ?? ''

  // Etapa de origem: a última mudança de etapa que NÃO seja "Repescagem"
  const notas = await prisma.note.findMany({
    where: { leadId, type: 'stage_change' }, orderBy: { createdAt: 'desc' }, take: 6, select: { content: true },
  })
  let etapaOrigem = ''
  for (const n of notas) {
    const m = n.content.match(/para "(.+?)"/i)
    if (m && !/repescagem/i.test(m[1])) { etapaOrigem = m[1]; break }
  }

  // Contexto: últimas mensagens da conversa
  const msgs = await prisma.message.findMany({
    where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 14, select: { direction: true, content: true },
  })
  const historico = msgs.reverse().map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Nós'}: ${m.content}`).join('\n').slice(0, 2500)

  // Há quanto tempo o cliente não responde (pra adaptar o tom ao tempo que passou)
  const ultimaDoCliente = await prisma.message.findFirst({
    where: { conversationId, direction: 'inbound' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
  })
  const diasSemResposta = ultimaDoCliente
    ? Math.max(0, Math.floor((Date.now() - new Date(ultimaDoCliente.createdAt).getTime()) / 86400000))
    : null

  const spHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  const saud = spHour >= 5 && spHour < 12 ? 'Bom dia' : spHour >= 12 && spHour < 18 ? 'Boa tarde' : 'Boa noite'

  const system = `Você é a Sol, atendente da KeroSolar (energia solar fotovoltaica). Este cliente conversou com a gente e PAROU de responder.
${etapaOrigem ? `Ele estava na etapa: "${etapaOrigem}".` : ''}
${diasSemResposta != null ? `Faz cerca de ${diasSemResposta} dia(s) que o cliente não responde.` : ''}
Sua tarefa: escrever UMA única mensagem de WhatsApp para tentar trazê-lo de volta, PERSONALIZADA pelo contexto da conversa abaixo.
Regras OBRIGATÓRIAS:
- Comece cumprimentando com "${saud}"${nome ? ` e use o nome "${nome}"` : ''}.
- ADAPTE o tom ao TEMPO QUE PASSOU: se foi há poucos dias, retome de forma leve; se já faz semanas ou meses, reconheça gentilmente que faz um tempo que não se falam (ex.: "faz um tempinho que a gente não se fala") — sem soar como cobrança.
- Seja MUITO educada, calorosa e respeitosa — NUNCA insistente, NUNCA grosseira.
- Mostre de forma GENTIL que a inação dele pode trazer PREJUÍZO (ex.: continuar pagando conta de luz cara todo mês, o orçamento perder a validade, perder uma condição/aprovação) — adapte ao que faz sentido pelo contexto.
- Curta (estilo WhatsApp), no máximo ~4 linhas. No máximo 1 emoji.
- NÃO invente valores, prazos ou aprovações que não apareçam no histórico.
- Responda SOMENTE com o texto da mensagem (sem aspas, sem explicação, sem JSON).

CONVERSA ATÉ AGORA:
${historico}`

  try {
    const out = await chat(cfg, system, [{ role: 'user', content: 'Escreva agora a mensagem de reengajamento.' }], 400)
    return (out || '').trim() || null
  } catch (e) {
    console.error('[reengage]', e)
    return null
  }
}
