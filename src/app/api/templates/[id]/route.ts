import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const { displayName, category, bodyText, variables, actionType } = body
  const template = await prisma.whatsappTemplate.update({
    where: { id },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(category !== undefined && { category }),
      ...(bodyText !== undefined && { bodyText }),
      ...(variables !== undefined && { variables }),
      ...(actionType !== undefined && { actionType }),
    },
  })
  return NextResponse.json({ template })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  await prisma.whatsappTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
