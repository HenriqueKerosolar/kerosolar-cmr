import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { lerTokenArquivo } from '@/lib/crm/link-arquivo'

// Link público ASSINADO de um anexo (link-arquivo.ts): o cliente do Instagram/Facebook abre o arquivo sem login.
// Sem token válido (ou vencido) → 404, igual a arquivo inexistente.
const UPLOADS_DIR = fs.existsSync('/data') ? '/data/uploads' : path.join(process.cwd(), 'uploads')

const TIPOS: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; nome: string }> }) {
  const { token, nome } = await params
  const arquivo = lerTokenArquivo(token)
  const naoAchou = () => new NextResponse('Arquivo não encontrado ou link vencido.', { status: 404 })
  if (!arquivo) return naoAchou()
  const caminho = path.join(UPLOADS_DIR, path.basename(arquivo))
  if (!fs.existsSync(caminho)) return naoAchou()
  const ext = path.extname(arquivo).toLowerCase()
  const amigavel = decodeURIComponent(nome || arquivo).replace(/["\r\n]/g, '')
  return new NextResponse(new Uint8Array(fs.readFileSync(caminho)), {
    headers: {
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${amigavel}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  })
}
