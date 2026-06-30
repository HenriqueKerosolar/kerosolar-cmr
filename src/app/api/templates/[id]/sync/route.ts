import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

const GRAPH = 'https://graph.facebook.com/v23.0'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id } = await params
  const template = await prisma.whatsappTemplate.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template não encontrado.' }, { status: 404 })

  // Busca a conta Cloud ativa para pegar o WABA ID
  const account = await prisma.whatsappAccount.findFirst({
    where: { provider: 'cloud', cloudWabaId: { not: null } },
  })
  if (!account?.cloudWabaId) {
    return NextResponse.json({ error: 'Nenhuma conta Cloud API configurada com WABA ID.' }, { status: 400 })
  }

  const token = process.env.WHATSAPP_CLOUD_TOKEN || ''
  const url = `${GRAPH}/${account.cloudWabaId}/message_templates?name=${encodeURIComponent(template.name)}&fields=id,name,status,category,language,components`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json() as { data?: Array<{ id: string; status: string; name: string }> }

  const found = data?.data?.[0]
  if (!found) {
    // Template não existe na Meta ainda — status permanece PENDENTE_ENVIO
    const updated = await prisma.whatsappTemplate.update({
      where: { id },
      data: { metaStatus: 'NAO_ENVIADO', lastSyncAt: new Date() },
    })
    return NextResponse.json({ template: updated, metaStatus: 'NAO_ENVIADO' })
  }

  const updated = await prisma.whatsappTemplate.update({
    where: { id },
    data: { metaStatus: found.status, metaId: found.id, lastSyncAt: new Date() },
  })

  return NextResponse.json({ template: updated, metaStatus: found.status })
}
