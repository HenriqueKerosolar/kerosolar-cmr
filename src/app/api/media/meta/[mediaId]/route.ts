import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

/**
 * Abre no navegador um arquivo que só existe na Meta (mensagens antigas guardavam
 * graph.facebook.com/<id>, que exige o token do WhatsApp). Baixa com o token e entrega o arquivo.
 * A Meta guarda a mídia por ~30 dias; depois disso não há mais como recuperar.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const session = await getSessionSafe()
  if (!session) return new NextResponse('Não autenticado', { status: 401 })
  const { mediaId } = await params
  if (!/^\d{5,30}$/.test(mediaId)) return new NextResponse('Id inválido', { status: 400 })
  const { downloadCloudMedia } = await import('@/lib/crm/cloud-api')
  const dl = await downloadCloudMedia(mediaId)
  if (!dl) return new NextResponse('A Meta não tem mais esse arquivo (ela guarda por cerca de 30 dias).', { status: 404 })
  return new NextResponse(new Uint8Array(dl.buffer), {
    headers: { 'Content-Type': dl.mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=86400' },
  })
}
