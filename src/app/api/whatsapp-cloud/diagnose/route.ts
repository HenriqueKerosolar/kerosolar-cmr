import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

const GRAPH = 'https://graph.facebook.com/v23.0'

type Check = { ok: boolean; label: string; detail?: string }

export async function POST() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const token = process.env.WHATSAPP_CLOUD_TOKEN || ''
  if (!token) {
    return NextResponse.json({
      checks: [
        { ok: false, label: 'Token configurado', detail: 'WHATSAPP_CLOUD_TOKEN não encontrado no .env' },
        { ok: false, label: 'Acesso à conta WhatsApp (WABA)', detail: 'Dependente do token' },
        { ok: false, label: 'Permissão de templates', detail: 'Dependente do token' },
        { ok: false, label: 'Número conectado', detail: 'Dependente do token' },
      ] as Check[],
    })
  }

  const checks: Check[] = []

  // Check 1: Token válido
  let userId: string | null = null
  try {
    const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`)
    const data = await res.json() as { id?: string; name?: string; error?: { message: string } }
    if (res.ok && data.id) {
      userId = data.id
      checks.push({ ok: true, label: 'Token válido', detail: data.name ?? data.id })
    } else {
      checks.push({ ok: false, label: 'Token válido', detail: data.error?.message ?? `HTTP ${res.status}` })
    }
  } catch (e) {
    checks.push({ ok: false, label: 'Token válido', detail: String(e) })
  }

  // Busca conta Cloud no banco
  const { prisma } = await import('@/lib/prisma')
  const account = await prisma.whatsappAccount.findFirst({
    where: { provider: 'cloud', cloudWabaId: { not: null } },
    select: { cloudWabaId: true, cloudPhoneNumberId: true, label: true },
  })

  const wabaId = account?.cloudWabaId ?? null
  const phoneNumberId = account?.cloudPhoneNumberId ?? null

  // Check 2: Acesso à conta WABA
  if (!userId || !wabaId) {
    checks.push({ ok: false, label: 'Acesso à conta WhatsApp (WABA)', detail: wabaId ? 'Token inválido' : 'WABA ID não configurado na conta' })
  } else {
    try {
      const res = await fetch(`${GRAPH}/${wabaId}?fields=name,currency&access_token=${token}`)
      const data = await res.json() as { name?: string; currency?: string; error?: { message: string } }
      if (res.ok && data.name) {
        checks.push({ ok: true, label: 'Acesso à conta WhatsApp (WABA)', detail: data.name })
      } else {
        checks.push({ ok: false, label: 'Acesso à conta WhatsApp (WABA)', detail: data.error?.message ?? `HTTP ${res.status}` })
      }
    } catch (e) {
      checks.push({ ok: false, label: 'Acesso à conta WhatsApp (WABA)', detail: String(e) })
    }
  }

  // Check 3: Permissão de templates
  if (!userId || !wabaId) {
    checks.push({ ok: false, label: 'Permissão de templates', detail: 'Dependente do WABA' })
  } else {
    try {
      const res = await fetch(`${GRAPH}/${wabaId}/message_templates?limit=1&access_token=${token}`)
      const data = await res.json() as { data?: unknown[]; error?: { message: string } }
      if (res.ok && Array.isArray(data.data)) {
        checks.push({ ok: true, label: 'Permissão de templates', detail: `${data.data.length >= 1 ? 'Acesso confirmado' : 'Sem templates ainda'}` })
      } else {
        checks.push({ ok: false, label: 'Permissão de templates', detail: data.error?.message ?? `HTTP ${res.status}` })
      }
    } catch (e) {
      checks.push({ ok: false, label: 'Permissão de templates', detail: String(e) })
    }
  }

  // Check 4: Número conectado
  if (!userId || !phoneNumberId) {
    checks.push({ ok: false, label: 'Número conectado', detail: phoneNumberId ? 'Token inválido' : 'Phone Number ID não configurado' })
  } else {
    try {
      const res = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating&access_token=${token}`)
      const data = await res.json() as {
        display_phone_number?: string
        verified_name?: string
        quality_rating?: string
        error?: { message: string }
      }
      if (res.ok && (data.display_phone_number || data.verified_name)) {
        const phone = data.display_phone_number ?? ''
        const name = data.verified_name ?? ''
        checks.push({ ok: true, label: 'Número conectado', detail: `${name}${phone ? ` (${phone})` : ''}` })
      } else {
        checks.push({ ok: false, label: 'Número conectado', detail: data.error?.message ?? `HTTP ${res.status}` })
      }
    } catch (e) {
      checks.push({ ok: false, label: 'Número conectado', detail: String(e) })
    }
  }

  return NextResponse.json({ checks })
}
