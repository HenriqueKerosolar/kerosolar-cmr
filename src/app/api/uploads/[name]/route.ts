import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSessionSafe } from '@/lib/dal'

// Mesmo critério do whatsapp.ts: volume persistente em produção (Railway), pasta local em dev
const UPLOADS_DIR = fs.existsSync('/data')
  ? '/data/uploads'
  : path.join(process.cwd(), 'uploads')

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  // Mídia recebida de leads via WhatsApp (fotos, áudio, documentos) só é
  // usada dentro do inbox do CRM — nunca buscada externamente pela Meta.
  // Os nomes de arquivo (timestamp + tamanho) não são difíceis de adivinhar,
  // então a proteção real precisa ser sessão, não só o nome.
  const session = await getSessionSafe()
  if (!session) return new NextResponse('Não autenticado', { status: 401 })

  const { name } = await params
  const safe = path.basename(name) // previne path traversal
  const file = path.join(UPLOADS_DIR, safe)
  if (!fs.existsSync(file)) return new NextResponse('Arquivo não encontrado', { status: 404 })
  const buf = fs.readFileSync(file)
  const ext = path.extname(safe).toLowerCase()
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
