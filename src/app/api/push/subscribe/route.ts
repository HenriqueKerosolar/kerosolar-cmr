import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/** Salva (ou atualiza) a inscrição de push do aparelho do operador. */
export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 401 })

  const sub = await req.json().catch(() => null) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'Inscrição inválida.' }, { status: 400 })
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: session.userId },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: session.userId },
  })
  return NextResponse.json({ ok: true })
}
