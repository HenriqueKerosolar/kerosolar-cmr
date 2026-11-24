import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

/** Texto livre do atendente para a variável {{2}}: a Meta não aceita quebra de linha, tab nem 4+ espaços seguidos. */
function limparTextoLivre(t: unknown): string {
  return String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000)
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id: leadId } = await context.params
  const { templateId, textoLivre } = await req.json() as { templateId: string; textoLivre?: string }

  const { prisma } = await import('@/lib/prisma')

  const [lead, template, conv] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, contact: { select: { name: true, phone: true, whatsappId: true } } },
    }),
    prisma.whatsappTemplate.findUnique({ where: { id: templateId } }),
    prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' } }),
  ])

  if (!lead) return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 })
  if (!template) return NextResponse.json({ error: 'Template não encontrado.' }, { status: 404 })
  if (!conv) return NextResponse.json({ error: 'Lead sem conversa ativa.' }, { status: 400 })
  if ((template.metaStatus ?? '').toUpperCase() !== 'APPROVED') {
    return NextResponse.json({ error: 'Template ainda não aprovado pela Meta.' }, { status: 400 })
  }

  const phone = lead.contact?.whatsappId || lead.contact?.phone
  if (!phone) return NextResponse.json({ error: 'Lead sem número de telefone.' }, { status: 400 })

  const firstName = (lead.contact?.name ?? '').split(' ')[0] || 'Cliente'

  // 24/11/2026: templates com TEXTO LIVRE do atendente em {{2}} (ex.: pedido de cotação ao fornecedor)
  const usadas = [...new Set([...template.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  const texto = limparTextoLivre(textoLivre)
  if (usadas.includes(2) && !texto) {
    return NextResponse.json({ error: 'Este template tem um espaço para o seu texto: escreva a mensagem antes de enviar.' }, { status: 400 })
  }
  const valores: Record<number, string> = { 1: firstName, 2: texto }
  const corpo = usadas.map((n) => valores[n] ?? '')

  const account = await prisma.whatsappAccount.findFirst({
    where: { provider: 'cloud', cloudPhoneNumberId: { not: null } },
    select: { cloudPhoneNumberId: true },
  })
  if (!account?.cloudPhoneNumberId) {
    return NextResponse.json({ error: 'Conta Cloud API não configurada.' }, { status: 400 })
  }

  try {
    const { sendCloudTemplate } = await import('@/lib/crm/cloud-api')
    const { componentesDeEnvio } = await import('@/lib/crm/template-meta')
    const components = componentesDeEnvio(template, corpo)
    await sendCloudTemplate(account.cloudPhoneNumberId, phone, template.name, template.language || 'pt_BR', components)

    // Registra no histórico da conversa (texto como o cliente recebeu)
    const body = template.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n)] ?? '')
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        senderType: 'human',
        senderUserId: session.userId,
        content: body,
      },
    })
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
