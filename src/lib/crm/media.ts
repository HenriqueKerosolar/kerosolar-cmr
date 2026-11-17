import 'server-only'
import path from 'path'
import fs from 'fs'
import { limparMidiaSeForHora } from './media-limpeza'

const UPLOADS_DIR = fs.existsSync('/data')
  ? '/data/uploads'
  : path.join(process.cwd(), 'uploads')

/** Salva um anexo recebido do cliente e devolve a URL pública (servida por /api/uploads/[name]). */
export function salvarMidiaRecebida(buffer: Buffer, ext: string): string | null {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    const safeExt = (ext || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
    const name = `in_${Date.now()}_${Math.round(buffer.length % 100000)}${safeExt.startsWith('.') ? safeExt : '.' + safeExt}`
    // Anexos antigos saem sozinhos (no máximo uma conferência a cada 6 horas), para o disco não encher de novo.
    limparMidiaSeForHora(UPLOADS_DIR)
    try {
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer)
    } catch (e) {
      // Disco cheio: limpa na hora e tenta gravar mais uma vez.
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOSPC') throw e
      limparMidiaSeForHora(UPLOADS_DIR, true)
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer)
    }
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
    return `${base}/api/uploads/${name}`
  } catch (e) {
    console.error('[media] salvarMidiaRecebida erro:', e)
    return null
  }
}
