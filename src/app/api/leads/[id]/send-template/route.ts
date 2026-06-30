import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id: leadId } = await context.params
  const { templateId } = await req.json() as { templateId: string }

  const { prisma } = await import('@/lib/prisma')

  const [lead, template, conv] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, contact: { select: { name: true, phone: true } } },
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

  const phone = lead.contact?.phone
  if (!phone) return NextResponse.json({ error: 'Lead sem número de telefone.' }, { status: 400 })

  const firstName = (lead.contact?.name ?? '').split(' ')[0] || 'Cliente'

  const account = await prisma.whatsappAccount.findFirst({
    where: { provider: 'cloud', cloudPhoneNumberId: { not: null } },
    select: { cloudPhoneNumberId: true },
  })
  if (!account?.cloudPhoneNumberId) {
    return NextResponse.json({ error: 'Conta Cloud API não configurada.' }, { status: 400 })
  }

  try {
    const { sendCloudTemplate } = await import('@/lib/crm/cloud-api')
    const components = [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]
    await sendCloudTemplate(account.cloudPhoneNumberId, phone, template.name, 'pt_BR', components)

    // Registra no histórico da conversa
    const body = template.bodyText.replace('{{1}}', firstName)
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
