import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSessionSafe } from '@/lib/dal'

const GRAPH = 'https://graph.facebook.com/v23.0'

export async function POST(req: Request) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const cloudToken = process.env.WHATSAPP_CLOUD_TOKEN
  if (!cloudToken) {
    return NextResponse.json({ error: 'Token WhatsApp Cloud não configurado.' }, { status: 503 })
  }

  // Pega o phone ID da primeira conta Cloud ativa no banco
  const { prisma } = await import('@/lib/prisma')
  const account = await prisma.whatsappAccount.findFirst({
    where: { provider: 'cloud', cloudPhoneNumberId: { not: null } },
  })
  if (!account?.cloudPhoneNumberId) {
    return NextResponse.json({ error: 'Nenhuma conta WhatsApp Cloud configurada no banco.' }, { status: 503 })
  }
  const cloudPhoneId = account.cloudPhoneNumberId

  try {
    // Lê a logo do arquivo público
    const logoPath = path.join(process.cwd(), 'public', 'kerosolar-logo.png')
    if (!fs.existsSync(logoPath)) {
      return NextResponse.json({ error: 'Logo não encontrada em public/kerosolar-logo.png' }, { status: 400 })
    }

    const logoBuffer = fs.readFileSync(logoPath)
    const blob = new Blob([logoBuffer], { type: 'image/png' })
    const file = new File([blob], 'kerosolar-logo.png', { type: 'image/png' })

    // Faz upload da logo como profile picture
    const form = new FormData()
    form.append('file', file)

    const res = await fetch(`${GRAPH}/${cloudPhoneId}/profile_picture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudToken}` },
      body: form,
    })

    const data = await res.json() as { success?: boolean; error?: { message?: string } }

    if (!res.ok) {
      console.error('[whatsapp set-profile-picture] erro:', data.error?.message)
      return NextResponse.json({ error: data.error?.message || 'Falha ao atualizar logo.' }, { status: 502 })
    }

    console.log('[whatsapp set-profile-picture] ✅ logo atualizada')
    return NextResponse.json({ ok: true, message: 'Logo da KeroSolar definida com sucesso no WhatsApp! 🎨' })
  } catch (err) {
    console.error('[whatsapp set-profile-picture] ERRO:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao atualizar logo.' }, { status: 500 })
  }
}
