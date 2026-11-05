// Ponto de entrada do que o Mind entrega pelo Nervo (eventos/chamadas assinados). Hoje só
// `social.engagement.captured` tem handler registrado (ver src/lib/nervo/fromEnv.ts); qualquer outro
// tipo entregue aqui recebe 503 (sem handler — o Mind reentrega depois, nunca é erro deste endpoint).
import { NextResponse } from 'next/server'
import { getCrmNervo } from '@/lib/nervo/fromEnv'

export async function POST(req: Request) {
  const nervo = getCrmNervo()
  if (!nervo) return NextResponse.json({ error: 'Nervo não configurado neste CRM.' }, { status: 503 })

  const body = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  const res = await nervo.receive({ headers, body })
  return NextResponse.json(res.body, { status: res.status })
}
