import 'server-only'
import webpush from 'web-push'
import { prisma } from '@/lib/prisma'

/**
 * Notificações push (Web Push / VAPID) pro app do operador no celular.
 * Variáveis de ambiente:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  → chave pública (também usada no cliente p/ inscrever)
 *   VAPID_PRIVATE_KEY             → chave privada (só servidor)
 *   VAPID_SUBJECT                 → mailto:... (contato)
 */

let configurado = false
function configurar(): boolean {
  if (configurado) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:kerosolar@kerosolar.com.br', pub, priv)
  configurado = true
  return true
}

type PushPayload = { title: string; body: string; url?: string; tag?: string }

/** Envia uma notificação push pra TODOS os aparelhos inscritos. Remove inscrições inválidas. */
export async function enviarPush(payload: PushPayload): Promise<void> {
  if (!configurar()) return
  const subs = await prisma.pushSubscription.findMany()
  if (!subs.length) return
  const data = JSON.stringify(payload)
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        data,
      )
    } catch (e: unknown) {
      // 404/410 = inscrição expirada/cancelada → remove
      const code = (e as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
      } else {
        console.error('[push] falha ao enviar:', code ?? e)
      }
    }
  }))
}
