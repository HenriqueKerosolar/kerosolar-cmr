import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password)
      return NextResponse.json({ error: 'Preencha todos os campos.' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive)
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok)
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 })

    await createSession({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as 'admin' | 'agent',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[login]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Erro interno: ${msg}` }, { status: 500 })
  }
}
