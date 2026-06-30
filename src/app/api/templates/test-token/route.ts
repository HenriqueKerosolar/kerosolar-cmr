import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

const GRAPH = 'https://graph.facebook.com/v23.0'

export async function POST() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const token = process.env.WHATSAPP_CLOUD_TOKEN || ''
  if (!token) return NextResponse.json({ ok: false, error: 'WHATSAPP_CLOUD_TOKEN não configurado no .env' })

  try {
    // Valida o token e busca info da conta
    const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`)
    const data = await res.json() as { id?: string; name?: string; error?: { message: string; code: number } }

    if (!res.ok || data.error) {
      return NextResponse.json({
        ok: false,
        error: data.error?.message || `Erro ${res.status}`,
        code: data.error?.code,
      })
    }

    // Busca info do WABA
    const { prisma } = await import('@/lib/prisma')
    const account = await prisma.whatsappAccount.findFirst({
      where: { provider: 'cloud', cloudWabaId: { not: null } },
      select: { cloudWabaId: true, cloudPhoneNumberId: true, label: true, phone: true },
    })

    let wabaName: string | null = null
    let phoneName: string | null = null

    if (account?.cloudWabaId) {
      const wabaRes = await fetch(`${GRAPH}/${account.cloudWabaId}?fields=name,currency&access_token=${token}`)
      const wabaData = await wabaRes.json() as { name?: string; currency?: string }
      wabaName = wabaData.name ?? null

      if (account.cloudPhoneNumberId) {
        const phoneRes = await fetch(`${GRAPH}/${account.cloudPhoneNumberId}?fields=display_phone_number,verified_name&access_token=${token}`)
        const phoneData = await phoneRes.json() as { display_phone_number?: string; verified_name?: string }
        phoneName = phoneData.verified_name ?? phoneData.display_phone_number ?? null
      }
    }

    return NextResponse.json({
      ok: true,
      userId: data.id,
      userName: data.name,
      wabaId: account?.cloudWabaId,
      wabaName,
      phoneId: account?.cloudPhoneNumberId,
      phoneName,
      accountLabel: account?.label,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}
