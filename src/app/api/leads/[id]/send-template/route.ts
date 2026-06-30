import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id: leadId } = await context.params
  const { templateId } = await req.json() as { templateId: string }

  const { prisma } = await import('@/lib/prisma')

  const [lead, template] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, contact: { select: { name: true, phone: true } } },
    }),
    prisma.whatsappTemplate.findUnique({ where: { id: templateId } }),
  ])

  if (!lead) return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 })
  if (!template) return NextResponse.json({ error: 'Template não encontrado.' }, { status: 404 })
  if ((template.metaStatus ?? '').toUpperCase() !== 'APPROVED') {
    return NextResponse.json({ error: 'Template ainda não aprovado pela Meta.' }, { status: 400 })
  }

  const phone = lead.contact?.phone
  if (!phone) return NextResponse.json({ error: 'Lead sem número de telefone.' }, { status: 400 })

  const firstName = (lead.contact?.name ?? '').split(' ')[0] || 'Cliente'

  try {
    const { sendCloudTemplate } = await import('@/lib/crm/cloud-api')
    await sendCloudTemplate(phone, template.name, [firstName])

    // Registra a mensagem no histórico
    const body = template.bodyText.replace('{{1}}', firstName)
    await prisma.message.create({
      data: {
        leadId,
        direction: 'outbound',
        senderType: 'human',
        channel: 'whatsapp',
        content: body,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
