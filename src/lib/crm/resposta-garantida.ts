import 'server-only'
// 🛟 RESPOSTA GARANTIDA (dono, 24/11/2026: "O que não pode acontecer é ficar sem a resposta nunca. O problema não é
// demorar e não chegar."). Incidente: o servidor reiniciou 40 s depois do "Faz com 300 kwh" e o processamento em
// segundo plano (after()) se perdeu — o cliente ficou sem nada.
//
// A cada minuto: mensagem de CLIENTE com a IA LIGADA que é a ÚLTIMA da conversa há mais de 5 min (o tempo máximo
// normal é ~3 min: espera de digitação + Belenus) e ainda não socorrida → processa de novo pelo motor (mesma
// mensagem, sem duplicar). Se o motor falhar de novo, manda um aviso curto ao cliente e chama o atendente.
// Depois de um handoff (IA desligada) nada é enviado — regra do dono. Tudo fica no banco: sobrevive a reinício.

import { prisma } from '@/lib/prisma'

export const ESPERA_MS = 5 * 60_000
const JANELA_MS = 60 * 60_000
const marca = (id: string) => `[resposta-garantida:${id}]`

/** Mensagens de cliente sem resposta (pura o suficiente para testar a regra de tempo). */
export function precisaSocorro(ultima: { direction: string; senderType: string; createdAt: Date }, agora = new Date()): boolean {
  const idade = agora.getTime() - ultima.createdAt.getTime()
  return ultima.direction === 'inbound' && ultima.senderType === 'contact' && idade >= ESPERA_MS && idade <= JANELA_MS
}

async function socorrer(conv: { id: string; channel: string; externalId: string | null; accountId: string | null; leadId: string | null; contact: { name: string | null; phone: string | null } | null },
  msg: { id: string; content: string; mediaType: string | null }) {
  const leadId = conv.leadId
  if (!leadId) return
  await prisma.note.create({ data: { leadId, type: 'system', content: `🛟 Mensagem do cliente ficou sem resposta por mais de 5 min — processando de novo. ${marca(msg.id)}` } })
  console.log('[resposta-garantida] socorrendo conversa %s (msg %s)', conv.id, msg.id)
  const inicio = new Date()
  try {
    if (msg.mediaType) throw new Error('mensagem com anexo: não dá para reler o arquivo aqui')
    const { ingestMessage } = await import('./engine')
    const r = await ingestMessage({
      channel: conv.channel as never, externalId: conv.externalId ?? '', text: msg.content, displayText: msg.content,
      name: conv.contact?.name ?? undefined, phone: conv.contact?.phone ?? undefined, accountId: conv.accountId,
      reprocessarId: msg.id, permitirBelenus: true,
    } as Parameters<typeof ingestMessage>[0])
    const { dispatchOutbound } = await import('./flow')
    // o motor grava a resposta no banco mas quem ENVIA é o chamador → troca o registro pelo envio de verdade
    const enviar = async (texto: string | null | undefined) => {
      if (!texto?.trim()) return
      await prisma.message.deleteMany({ where: { conversationId: conv.id, direction: 'outbound', externalId: null, createdAt: { gte: inicio }, content: texto } })
      await dispatchOutbound(conv.id, texto, undefined, 'ai', undefined, true)
    }
    await enviar(r?.reply)
    for (const extra of r?.followUps ?? []) await enviar(extra)
    if (r?.documentoDepois) { const { enviarDocumentoDepois } = await import('./belenus/auto'); await enviarDocumentoDepois(r.documentoDepois) }
    if (r?.followUp) await dispatchOutbound(conv.id, r.followUp, undefined, 'ai')
    // conferência: saiu alguma coisa?
    const saiu = await prisma.message.findFirst({ where: { conversationId: conv.id, direction: 'outbound', createdAt: { gte: inicio } }, select: { id: true } })
    const desligou = await prisma.conversation.findUnique({ where: { id: conv.id }, select: { aiEnabled: true } })
    // motor rodou mas decidiu não responder (ex.: "obrigado", spam) → não inventa mensagem; só chama o atendente
    if (!saiu && desligou?.aiEnabled !== false) {
      await prisma.task.create({ data: { leadId, title: '🛟 IA não respondeu a última mensagem do cliente — conferir', type: 'message', dueAt: new Date() } }).catch(() => {})
      await prisma.note.create({ data: { leadId, type: 'system', content: '🛟 Reprocessado: a IA decidiu não responder esta mensagem. Atendente avisado para conferir.' } }).catch(() => {})
    }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[resposta-garantida] falhou de novo (%s) — aviso ao cliente + atendente', motivo)
    const { dispatchOutbound } = await import('./flow')
    await dispatchOutbound(conv.id, 'Recebi sua mensagem 😊 Já estou verificando e te respondo em instantes!', undefined, 'ai', undefined, true).catch(() => {})
    await prisma.task.create({ data: { leadId, title: '🛟 Cliente sem resposta automática — responder agora', type: 'message', dueAt: new Date() } }).catch(() => {})
    await prisma.note.create({ data: { leadId, type: 'system', content: `⚠️ Resposta garantida: o reprocessamento falhou (${motivo}). Cliente recebeu aviso curto; atendente chamado.` } }).catch(() => {})
    const { enviarPush } = await import('./push')
    enviarPush({ title: `🛟 Cliente sem resposta — ${conv.contact?.name || conv.contact?.phone || 'cliente'}`, body: `Responder agora. Motivo: ${motivo}`.slice(0, 180), url: `/leads/${leadId}`, tag: `garantida-${conv.id}` }).catch(() => {})
  }
}

let rodando = false
export async function verificarRespostas(agora = new Date()): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    const convs = await prisma.conversation.findMany({
      where: { aiEnabled: true, channel: { in: ['whatsapp', 'instagram', 'facebook'] }, lastMessageAt: { gte: new Date(agora.getTime() - JANELA_MS) }, lead: { humanOnly: false } },
      select: { id: true, channel: true, externalId: true, accountId: true, leadId: true, contact: { select: { name: true, phone: true } } },
      take: 50,
    })
    for (const conv of convs) {
      const ultima = await prisma.message.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, select: { id: true, direction: true, senderType: true, createdAt: true, content: true, mediaType: true } })
      if (!ultima || !precisaSocorro(ultima, agora) || !conv.leadId) continue
      const ja = await prisma.note.findFirst({ where: { leadId: conv.leadId, content: { contains: marca(ultima.id) } }, select: { id: true } })
      if (ja) continue
      await socorrer(conv, ultima)
    }
  } catch (e) {
    console.error('[resposta-garantida]', e)
  } finally {
    rodando = false
  }
}

export function iniciarRespostaGarantida(): void {
  const g = globalThis as unknown as { __respostaGarantida?: NodeJS.Timeout }
  if (g.__respostaGarantida) return
  if (process.env.RESPOSTA_GARANTIDA === '0') return
  setTimeout(() => void verificarRespostas(), 45_000)   // logo depois de subir (pega o que o reinício derrubou)
  g.__respostaGarantida = setInterval(() => void verificarRespostas(), 60_000)
}
