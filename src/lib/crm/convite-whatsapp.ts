// Convite Instagram/Facebook → WhatsApp (pedido do dono, 15/11/2026).
//
// Quando o cliente do Direct/Messenger mostra INTERESSE REAL — manda a conta de luz, pede orçamento por kWh
// ou por R$, ou diz que vai conversar com a esposa/marido/família — o CRM pergunta UMA vez se ele quer seguir
// pelo WhatsApp e manda o link. O link já abre o WhatsApp com um CÓDIGO; quando essa mensagem chega, o CRM
// junta o WhatsApp ao MESMO contato e lead (mesma etapa, mesmo orçamento, histórico do Direct incluído) e
// marca o lead como prioridade (quem clica no link é cliente com muito interesse).
//
// Por que o código: a Meta não informa o telefone de quem escreve pelo Direct/Messenger; sem ele não há como
// saber que o número novo é a mesma pessoa.
import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizarCodigo, extrairCodigoConvite, gerarCodigoConvite, linkConviteWhatsapp, textoConvite } from './convite-whatsapp-texto'

export { interesseReal } from './convite-whatsapp-texto'

export type ConviteWhats = { code: string; leadId: string; channel: string; criadoEm: string; usadoEm?: string; waId?: string }

export function lerConvite(customFields: unknown): ConviteWhats | null {
  const c = (customFields as Record<string, unknown> | null)?.conviteWhats as Partial<ConviteWhats> | undefined
  return c?.code && c.leadId ? (c as ConviteWhats) : null
}

/**
 * Cria o convite (uma vez por contato) e devolve o texto a mandar no Direct/Messenger.
 * `null` = já foi convidado antes (nunca repetir o convite).
 */
export async function criarConviteWhatsapp(contactId: string, leadId: string, channel: string): Promise<string | null> {
  const contato = await prisma.contact.findUnique({ where: { id: contactId }, select: { customFields: true, whatsappId: true } })
  if (!contato || contato.whatsappId) return null
  const cf = (contato.customFields as Record<string, unknown> | null) ?? {}
  if (lerConvite(cf)) return null

  let code = gerarCodigoConvite()
  for (let i = 0; i < 5; i++) {
    const usado = await prisma.contact.findFirst({ where: { customFields: { path: ['conviteWhats', 'code'], equals: code } }, select: { id: true } })
    if (!usado) break
    code = gerarCodigoConvite()
  }
  const convite: ConviteWhats = { code, leadId, channel, criadoEm: new Date().toISOString() }
  await prisma.contact.update({ where: { id: contactId }, data: { customFields: { ...cf, conviteWhats: convite } as object } })
  await prisma.note.create({ data: { leadId, type: 'system', content: `Convite para seguir no WhatsApp enviado (código ${code}).` } }).catch(() => {})
  return textoConvite(linkConviteWhatsapp(code, channel))
}

/**
 * Mensagem chegando no WhatsApp com o código do convite → junta ao contato/lead do Direct.
 * Devolve o contato e o lead a usar, ou `null` se a mensagem não traz um código válido.
 */
export async function resolverConviteWhatsapp(texto: string, waId: string, phone?: string | null): Promise<{ contactId: string; leadId: string } | null> {
  const bruto = extrairCodigoConvite(texto)
  if (!bruto) return null
  const code = normalizarCodigo(bruto)
  const origem = await prisma.contact.findFirst({
    where: { customFields: { path: ['conviteWhats', 'code'], equals: code } },
    select: { id: true, whatsappId: true, phone: true, customFields: true, instagramId: true, facebookId: true },
  })
  if (!origem) return null
  const cf = (origem.customFields as Record<string, unknown> | null) ?? {}
  const convite = lerConvite(cf)
  if (!convite) return null
  // Código já usado por OUTRO número: não junta (evita misturar duas pessoas).
  if (origem.whatsappId && origem.whatsappId !== waId) return null

  const lead = await prisma.lead.findUnique({ where: { id: convite.leadId }, select: { id: true, status: true } })
  if (!lead) return null
  const jaUsado = !!convite.usadoEm
  const telefone = phone && /^\d{10,15}$/.test(phone) ? phone : /^55\d{10,11}$/.test(waId) ? waId : null
  const marcado: ConviteWhats = { ...convite, usadoEm: convite.usadoEm ?? new Date().toISOString(), waId }

  let contactId = origem.id
  const contatoWa = await prisma.contact.findFirst({ where: { whatsappId: waId, id: { not: origem.id } }, select: { id: true, customFields: true, phone: true } })
  if (!contatoWa) {
    // Caso comum: o número ainda não existe no CRM → vira o WhatsApp do mesmo contato do Direct.
    await prisma.contact.update({
      where: { id: origem.id },
      data: { whatsappId: waId, ...(origem.phone ? {} : telefone ? { phone: telefone } : {}), customFields: { ...cf, conviteWhats: marcado } as object },
    })
  } else {
    // O número já tinha contato (ex.: escreveu antes no WhatsApp): leva o Direct + o lead para ele.
    contactId = contatoWa.id
    const cfWa = (contatoWa.customFields as Record<string, unknown> | null) ?? {}
    await prisma.$transaction([
      prisma.contact.update({ where: { id: origem.id }, data: { instagramId: null, facebookId: null } }),
      prisma.contact.update({
        where: { id: contatoWa.id },
        data: {
          ...(origem.instagramId ? { instagramId: origem.instagramId } : {}),
          ...(origem.facebookId ? { facebookId: origem.facebookId } : {}),
          ...(contatoWa.phone ? {} : telefone ? { phone: telefone } : {}),
          customFields: { ...cfWa, metaBridge: cf.metaBridge, conviteWhats: marcado } as object,
        },
      }),
      prisma.conversation.updateMany({ where: { contactId: origem.id, channel: { in: ['instagram', 'facebook'] } }, data: { contactId: contatoWa.id } }),
      prisma.lead.update({ where: { id: lead.id }, data: { contactId: contatoWa.id } }),
    ])
  }

  if (!jaUsado) {
    // Daqui em diante o atendimento é pelo WhatsApp: a IA para de responder no Direct/Messenger.
    await prisma.conversation.updateMany({ where: { leadId: lead.id, channel: { in: ['instagram', 'facebook'] } }, data: { aiEnabled: false } })
    await prisma.lead.update({ where: { id: lead.id }, data: { highPriority: true, ...(lead.status !== 'open' ? { status: 'open', closedAt: null } : {}) } })
    await prisma.note.create({
      data: { leadId: lead.id, type: 'system', content: `🔥 Cliente clicou no link e veio do ${convite.channel === 'facebook' ? 'Facebook' : 'Instagram'} para o WhatsApp (código ${code}) — MUITO INTERESSE. Conversa unida a este lead.` },
    }).catch(() => {})
  }
  return { contactId, leadId: lead.id }
}
