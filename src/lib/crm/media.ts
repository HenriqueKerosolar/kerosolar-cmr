import 'server-only'
import path from 'path'
import fs from 'fs'

const UPLOADS_DIR = fs.existsSync('/data')
  ? '/data/uploads'
  : path.join(process.cwd(), 'uploads')

/** Salva um anexo recebido do cliente e devolve a URL pública (servida por /api/uploads/[name]). */
export function salvarMidiaRecebida(buffer: Buffer, ext: string): string | null {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    const safeExt = (ext || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
    const name = `in_${Date.now()}_${Math.round(buffer.length % 100000)}${safeExt.startsWith('.') ? safeExt : '.' + safeExt}`
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer)
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
    return `${base}/api/uploads/${name}`
  } catch (e) {
    console.error('[media] salvarMidiaRecebida erro:', e)
    return null
  }
}
