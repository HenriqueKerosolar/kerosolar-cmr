import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

const ALLOWED_KEYS = ['ai_provider', 'anthropic_key', 'openai_key', 'ai_model', 'bot_name', 'bot_prompt', 'handoff_message', 'low_consumption_message', 'return_message', 'after_hours_message', 'after_hours_resume_message', 'budget_followup_message', 'consultant_name', 'financing_table', 'welcome_variants']

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 })

  const body = await req.json() as Record<string, string>
  const entries = Object.entries(body).filter(([k]) => ALLOWED_KEYS.includes(k))

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
