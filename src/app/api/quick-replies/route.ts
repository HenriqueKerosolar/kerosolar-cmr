import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

// ⚡ Respostas rápidas do atendente (pedido do dono, 23/11/2026): frases prontas escritas por ele,
// guardadas em system_configs.quick_replies (JSON). Valem para todos os atendentes.
const KEY = 'quick_replies'
type QR = { id: string; titulo: string; texto: string }

function limpar(lista: unknown): QR[] {
  if (!Array.isArray(lista)) return []
  return lista
    .map((x) => x as Partial<QR>)
    .filter((x) => typeof x?.texto === 'string' && x.texto.trim())
    .slice(0, 200)
    .map((x, i) => ({
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : `qr${Date.now()}${i}`,
      titulo: String(x.titulo ?? '').trim().slice(0, 60) || String(x.texto).trim().slice(0, 30),
      texto: String(x.texto).trim().slice(0, 4000),
    }))
}

export async function GET() {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const cfg = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  let lista: QR[] = []
  try { lista = limpar(JSON.parse(cfg?.value || '[]')) } catch { lista = [] }
  return NextResponse.json({ respostas: lista })
}

export async function PUT(req: Request) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const body = await req.json().catch(() => null) as { respostas?: unknown } | null
  const lista = limpar(body?.respostas)
  await prisma.systemConfig.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(lista) },
    update: { value: JSON.stringify(lista) },
  })
  return NextResponse.json({ respostas: lista })
}
