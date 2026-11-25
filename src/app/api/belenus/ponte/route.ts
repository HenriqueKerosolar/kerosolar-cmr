// 🌉 Ponte da Belenus pelo navegador (ver src/lib/crm/belenus/ponte.ts). Só administradores logados.
// GET  ?n=<id do navegador> → espera até 20 s por um pedido; devolve { pedido } ou { pedido: null }.
// POST { id, status, tipo, texto } | { id, erro } → entrega a resposta da Belenus ao robô.
import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { devolverResposta, pegarPedido } from '@/lib/crm/belenus/ponte'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function admin() {
  const s = await getSessionSafe()
  return s?.userId && s.role === 'admin' ? s : null
}

export async function GET(req: Request) {
  const s = await admin()
  if (!s) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const n = new URL(req.url).searchParams.get('n')?.slice(0, 64) || s.userId
  const pedido = await pegarPedido(`${s.userId}:${n}`)
  return NextResponse.json({ pedido }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: Request) {
  const s = await admin()
  if (!s) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const b = (await req.json().catch(() => null)) as { id?: string; status?: number; tipo?: string; texto?: string; erro?: string } | null
  if (!b?.id) return NextResponse.json({ erro: 'sem id' }, { status: 400 })
  const ok = devolverResposta(b.id, b.erro ? { erro: String(b.erro).slice(0, 200) } : { status: Number(b.status), tipo: b.tipo, texto: String(b.texto ?? '') })
  return NextResponse.json({ ok })
}
