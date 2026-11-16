import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { submeterTemplate } from '@/lib/crm/template-meta'

/**
 * Envia o template para APROVAÇÃO da Meta (a lógica fica em lib/crm/template-meta.ts, que também trata
 * cabeçalho com arquivo — ex.: o ebook em PDF).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id } = await params
  try {
    const template = await submeterTemplate(id)
    return NextResponse.json({ template, metaStatus: template.metaStatus })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro ao enviar para a Meta.' }, { status: 400 })
  }
}
