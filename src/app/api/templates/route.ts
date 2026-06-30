import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const templates = await prisma.whatsappTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await req.json()
  const { name, displayName, category, language, bodyText, variables, actionType } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório.' }, { status: 400 })
  if (!bodyText?.trim()) return NextResponse.json({ error: 'Texto obrigatório.' }, { status: 400 })

  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 512)

  const template = await prisma.whatsappTemplate.create({
    data: {
      name: cleanName,
      displayName: displayName?.trim() || cleanName,
      category: category || 'MARKETING',
      language: language || 'pt_BR',
      bodyText: bodyText.trim(),
      variables: variables ?? [],
      actionType: actionType || null,
      metaStatus: 'PENDENTE_ENVIO',
    },
  })

  return NextResponse.json({ template })
}
