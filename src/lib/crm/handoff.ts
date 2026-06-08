import 'server-only'
import { prisma } from '@/lib/prisma'

export const DEFAULT_HANDOFF_MESSAGE =
  'Entendido! 🙋 A partir de agora vou desativar o atendimento automático para você. ' +
  'Você será transferido para um de nossos atendentes humanos e em breve será atendido. Obrigado pela paciência!'

/** Dentro do horário comercial de atendimento? (seg–sex, 9h–18h, fuso de Brasília) */
function dentroDoHorarioComercial(): boolean {
  const spHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  const spDay = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' })
  const diaUtil = !['Sat', 'Sun'].includes(spDay)
  return diaUtil && spHour >= 9 && spHour < 18
}

/**
 * Mensagem de transferência para o consultor (dinâmica):
 * - dentro do horário: avisa que o consultor entra em contato em breve
 * - fora do horário: avisa que já encaminhou e o atendimento segue no horário comercial
 * Nome do consultor configurável (key consultant_name, padrão "Henrique Leal").
 */
export async function getHandoffMessage(): Promise<string> {
  const nameRow = await prisma.systemConfig.findUnique({ where: { key: 'consultant_name' } })
  const consultor = nameRow?.value?.trim() || 'Henrique Leal'
  const base = `Perfeito! Já encaminhei seu atendimento para o nosso consultor ${consultor}.`
  return dentroDoHorarioComercial()
    ? `${base} Em breve ele entra em contato com você 😊`
    : `${base} O atendimento continuará no horário comercial 😊`
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
    /\b(transfer\w+|falar|quero)\b.*\b(consultor|especialista|atendente)\b/,
    /\b(quero|pode)\s+(o\s+)?consultor\b/,
    /\bnao\s+(e|eh|é)\s+(bot|rob[oô]|ia)\??/,
    /^(ja\s+)?(fui\s+|ja\s+fui\s+)?atendid[ao][.!]?$/,  // "atendido" — botão do aviso de migração
    /\bja\s+(fui\s+)?atendid[ao]\b/,
  ]
  return patterns.some((re) => re.test(t))
}

/**
 * Executa a transferência: desliga a IA do lead+conversa, cria tarefa e nota,
 * e registra a mensagem padrão de transferência. Devolve o texto a enviar.
 */
export async function performHandoff(leadId: string, conversationId: string, reason = 'Cliente pediu atendimento humano'): Promise<string> {
  const msg = await getHandoffMessage()
  // Bloqueio TOTAL: desliga IA + marca humanOnly (impede QUALQUER automação)
  await prisma.lead.update({ where: { id: leadId }, data: { aiEnabled: false, humanOnly: true } })
  await prisma.conversation.update({ where: { id: conversationId }, data: { aiEnabled: false, lastMessageAt: new Date() } })
  // Cancela todas as ações agendadas pendentes (chamadas, timers de inatividade)
  await prisma.scheduledAction.updateMany({ where: { leadId, done: false }, data: { done: true } })
  await prisma.task.create({ data: { leadId, title: reason, type: 'message', dueAt: new Date() } })
  await prisma.note.create({ data: { leadId, type: 'system', content: `${reason} — TODAS as automações pausadas, transferido para humano.` } })
  await prisma.message.create({
    data: { conversationId, direction: 'outbound', senderType: 'system', content: msg },
  })
  return msg
}
