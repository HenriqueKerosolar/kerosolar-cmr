// 🔗 Link PÚBLICO e ASSINADO para um anexo do CRM (24/11/2026). Os anexos (/api/uploads) só abrem com login;
// para mandar um arquivo pelo Instagram/Facebook (a ponte do Mind Marketing só leva texto) o cliente recebe
// este link: impossível de adivinhar (HMAC com SESSION_SECRET) e com validade (padrão 30 dias).
import crypto from 'crypto'

const DIAS_PADRAO = 30

function segredo(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET ausente')
  return s
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')

function assinatura(corpo: string): string {
  return b64(crypto.createHmac('sha256', segredo()).update(`arquivo:${corpo}`).digest()).slice(0, 32)
}

/** Token para o arquivo `nome` (só o nome em /data/uploads, sem pasta). */
export function assinarArquivo(nome: string, dias = DIAS_PADRAO, agora = Date.now()): string {
  const exp = Math.floor(agora / 1000) + dias * 86400
  const corpo = `${b64(nome)}.${exp}`
  return `${corpo}.${assinatura(corpo)}`
}

/** Devolve o nome do arquivo se o token for válido e não tiver vencido; senão null. */
export function lerTokenArquivo(token: string, agora = Date.now()): string | null {
  const partes = (token || '').split('.')
  if (partes.length !== 3) return null
  const [n, exp, sig] = partes
  const corpo = `${n}.${exp}`
  const esperado = assinatura(corpo)
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < agora) return null
  const nome = Buffer.from(n, 'base64url').toString()
  if (!nome || nome.includes('/') || nome.includes('\\') || nome.startsWith('.')) return null
  return nome
}

/** URL pública para o arquivo salvo (mediaUrl ".../api/uploads/<nome>"), com o nome amigável no fim. */
export function linkPublicoDoAnexo(mediaUrl: string, nomeAmigavel?: string, dias = DIAS_PADRAO): string | null {
  const m = /\/api\/uploads\/([^/?#]+)$/.exec(mediaUrl || '')
  if (!m) return null
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || ''
  const amigavel = (nomeAmigavel || m[1]).replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-') || m[1]
  return `${base}/api/arquivo/${assinarArquivo(m[1], dias)}/${encodeURIComponent(amigavel)}`
}
