import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { dispatchOutbound } from '@/lib/crm/flow'

const UPLOADS_DIR = fs.existsSync('/data')
  ? '/data/uploads'
  : path.join(process.cwd(), 'uploads')

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB (limite do WhatsApp para documentos comuns)

function mediaTypeFor(mime: string): 'image' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id: leadId } = await params

  const form = await req.formData()
  const file = form.get('file') as File | null
  const caption = (form.get('caption') as string | null)?.trim() || ''
  if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx. 25 MB).' }, { status: 400 })

  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' } })
  if (!conv) return NextResponse.json({ error: 'Esse lead ainda não tem conversa.' }, { status: 400 })

  // Salva o arquivo no volume persistente
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  const ext = path.extname(file.name) || ''
  const safeName = `${conv.id}-${Date.now()}${ext}`.replace(/[^a-zA-Z0-9._-]/g, '')
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer)

  // URL pública servida pela rota /api/uploads/[name]
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
  const url = `${base}/api/uploads/${safeName}`
  const type = mediaTypeFor(file.type || '')

  try {
    await dispatchOutbound(conv.id, caption, { url, type }, 'human', session.userId)
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
    return NextResponse.json({ ok: true, url, type })
  } catch (err) {
    console.error('[send-media]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao enviar o arquivo.' }, { status: 500 })
  }
}
