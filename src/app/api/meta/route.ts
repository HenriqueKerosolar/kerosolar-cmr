import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const rows = await prisma.channelIntegration.findMany({ where: { channel: { in: ['facebook', 'instagram'] } } })
  const pipelines = await prisma.pipeline.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, icon: true } })
  // não devolve o token cru por segurança — só indica se está preenchido
  const safe = rows.map((r) => {
    const c = (r.config as Record<string, unknown>) ?? {}
    return { channel: r.channel, enabled: r.enabled, pageId: c.pageId ?? '', igId: c.igId ?? '', hasToken: !!c.pageAccessToken, verifyToken: c.verifyToken ?? '', pipelineId: c.pipelineId ?? '' }
  })
  return NextResponse.json({ connections: safe, pipelines })
}

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 })
  const body = await req.json()
  const channel = body.channel === 'instagram' ? 'instagram' : 'facebook'

  const config = {
    pageId: body.pageId?.trim() ?? '',
    igId: body.igId?.trim() ?? '',
    pageAccessToken: body.pageAccessToken?.trim() ?? '',
    verifyToken: body.verifyToken?.trim() || 'kerosolar-verify',
    pipelineId: body.pipelineId || null,
  }

  await prisma.channelIntegration.upsert({
    where: { channel },
    create: { channel, enabled: true, config },
    update: { enabled: true, config },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const channel = new URL(req.url).searchParams.get('channel') === 'instagram' ? 'instagram' : 'facebook'
  await prisma.channelIntegration.update({ where: { channel }, data: { enabled: false } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
