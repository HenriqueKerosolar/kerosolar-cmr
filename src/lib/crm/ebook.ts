// 🎁 Ebook de presente para todo cliente que chega (pedido do dono, 17/11/2026): "quando o cliente chegar,
// depois de um tempo" ele recebe o Guia Anti-Cilada Solar — em QUALQUER canal, uma vez só por contato.
//   WhatsApp: o texto de presente + o PDF anexado.
//   Instagram / Facebook / chat do site: o texto com o link do PDF (esses canais passam pelo Mind
//   Marketing / pelo site e hoje só levam texto).
// O PDF fica no site (kerosolar-site: public/ebook-kerosolar.pdf) — trocar o arquivo lá troca para todos.
import 'server-only'
import { prisma } from '@/lib/prisma'

export const EBOOK_URL = 'https://www.kerosolar.com.br/ebook-kerosolar.pdf'
export const EBOOK_NOME_ARQUIVO = 'Guia Anti-Cilada Solar - KeroSolar.pdf'
/** Quanto tempo depois do primeiro contato o ebook sai (minutos). */
export const EBOOK_ATRASO_MIN = 60

export function textoEbook(comLink: boolean): string {
  const base = '🎁 Um presente pra você: o *Guia Anti-Cilada Solar*, nosso ebook com tudo o que você precisa saber antes de investir em energia solar (como comparar orçamentos, a Lei 14.300, inversores, financiamento...). Vale a leitura! 😊'
  return comLink ? `${base}\n${EBOOK_URL}` : base
}

/** Agenda o ebook para um lead NOVO (chamado pelo motor quando o lead é criado). Uma vez por contato. */
export async function agendarEbook(leadId: string, conversationId: string, contactId: string, channel: string): Promise<void> {
  if (channel === 'simulator') return
  const ct = await prisma.contact.findUnique({ where: { id: contactId }, select: { customFields: true } })
  const cf = (ct?.customFields as Record<string, unknown> | null) ?? {}
  if (cf.ebookEnviadoEm || cf.ebookAgendadoEm) return
  await prisma.scheduledAction.create({
    data: { leadId, conversationId, type: 'send_ebook', payload: {} as object, runAt: new Date(Date.now() + EBOOK_ATRASO_MIN * 60_000) },
  })
  await prisma.contact.update({ where: { id: contactId }, data: { customFields: { ...cf, ebookAgendadoEm: new Date().toISOString() } as object } })
}

/**
 * Envia o ebook (ação `send_ebook`). Não envia se: o lead está só com atendimento humano, o atendente
 * assumiu a conversa (IA pausada), o contato já recebeu, ou o atendente já mandou um PDF na conversa.
 * Devolve false quando não enviou.
 */
export async function enviarEbook(a: { leadId: string; conversationId: string }): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { humanOnly: true, aiEnabled: true, contactId: true } })
  if (!lead || lead.humanOnly || !lead.aiEnabled || !lead.contactId) return false
  const ct = await prisma.contact.findUnique({ where: { id: lead.contactId }, select: { customFields: true } })
  const cf = (ct?.customFields as Record<string, unknown> | null) ?? {}
  if (cf.ebookEnviadoEm) return false
  // a conversa pode ter mudado de canal (convite Instagram → WhatsApp): manda na conversa mais recente do lead
  const conv = await prisma.conversation.findFirst({ where: { leadId: a.leadId }, orderBy: { lastMessageAt: 'desc' } })
    ?? await prisma.conversation.findUnique({ where: { id: a.conversationId } })
  if (!conv) return false
  const jaTemPdf = await prisma.message.count({ where: { conversation: { leadId: a.leadId }, direction: 'outbound', mediaType: 'document' } })
  if (jaTemPdf > 0) return false

  const { dispatchOutbound } = await import('./flow')
  if (conv.channel === 'whatsapp') {
    await dispatchOutbound(conv.id, textoEbook(false), undefined, 'ai')
    // no WhatsApp a legenda do documento vira o NOME do arquivo
    await dispatchOutbound(conv.id, EBOOK_NOME_ARQUIVO, { url: EBOOK_URL, type: 'document' }, 'ai')
  } else {
    await dispatchOutbound(conv.id, textoEbook(true), undefined, 'ai')
  }
  await prisma.contact.update({ where: { id: lead.contactId }, data: { customFields: { ...cf, ebookEnviadoEm: new Date().toISOString() } as object } })
  await prisma.note.create({ data: { leadId: a.leadId, type: 'system', content: `🎁 Ebook (Guia Anti-Cilada Solar) enviado pelo ${conv.channel}.` } }).catch(() => {})
  return true
}
