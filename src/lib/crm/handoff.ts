import 'server-only'
import { prisma } from '@/lib/prisma'

export const DEFAULT_HANDOFF_MESSAGE =
  'Entendido! 🙋 A partir de agora vou desativar o atendimento automático para você. ' +
  'Você será transferido para um de nossos atendentes humanos e em breve será atendido. Obrigado pela paciência!'

/** Mensagem de transferência (configurável em Config → key handoff_message). */
export async function getHandoffMessage(): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'handoff_message' } })
  return row?.value?.trim() || DEFAULT_HANDOFF_MESSAGE
}

/**
 * Detecta se o cliente NÃO quer falar com bot/IA (pede humano, reclama do robô, etc.).
 * Funciona por palavras-chave — garante a transferência mesmo sem depender da IA.
 */
export function wantsHuman(text: string): boolean {
  const t = text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  const patterns: RegExp[] = [
    /\b(quero|preciso|gostaria|posso)\s+(falar|conversar)\s+com\s+(um\s+)?(atendente|humano|pessoa|vendedor|consultor|alguem)\b/,
    /\bfalar\s+com\s+(um\s+)?(atendente|humano|pessoa|gente|alguem)\b/,
    /\b(atendente|atendimento)\s+(humano|real|de verdade)\b/,
    /\bnao\s+(quero|gosto|aguento|to afim|estou afim)\s+(falar\s+)?(com\s+)?(o\s+)?(bot|rob[oô]|ia|intelig[eê]ncia|m[aá]quina|gravacao|atendente virtual)\b/,
    /\b(e|eh|é)\s+(um\s+)?(bot|rob[oô]|ia|maquina)\b\??/,
    /\b(voce|vc|tu)\s+(e|eh|é)\s+(um\s+)?(bot|rob[oô]|ia|maquina)\b/,
    /\b(odeio|detesto|cansei|chega)\s+de\s+(bot|rob[oô]|ia|atendente virtual)\b/,
    /\b(sair|parar|para|chega)\s+(do|de|com o)\s+(bot|rob[oô]|ia|atendimento automatico)\b/,
    /\bquero\s+(um\s+)?humano\b/,
    /\bme\s+(transfere|transfira|passa)\s+(para|pro|pra)\b/,
    /\bnao\s+(e|eh|é)\s+(bot|rob[oô]|ia)\??/,
  ]
  return patterns.some((re) => re.test(t))
}

/**
 * Executa a transferência: desliga a IA do lead+conversa, cria tarefa e nota,
 * e registra a mensagem padrão de transferência. Devolve o texto a enviar.
 */
export async function performHandoff(leadId: string, conversationId: string, reason = 'Cliente pediu atendimento humano'): Promise<string> {
  const msg = await getHandoffMessage()
  await prisma.lead.update({ where: { id: leadId }, data: { aiEnabled: false } })
  await prisma.conversation.update({ where: { id: conversationId }, data: { aiEnabled: false, lastMessageAt: new Date() } })
  await prisma.task.create({ data: { leadId, title: reason, type: 'message', dueAt: new Date() } })
  await prisma.note.create({ data: { leadId, type: 'system', content: `${reason} — IA desativada, transferido para humano.` } })
  await prisma.message.create({
    data: { conversationId, direction: 'outbound', senderType: 'system', content: msg },
  })
  return msg
}
