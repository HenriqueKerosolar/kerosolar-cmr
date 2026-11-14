import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

const GRAPH = 'https://graph.facebook.com/v23.0'

/** Exemplos que a Meta exige para cada variável {{n}} do corpo (usados só na análise da Meta). */
function exemploDaVariavel(descricao: string): string {
  const d = descricao.toLowerCase()
  if (/nome|lead|cliente/.test(d)) return 'Maria'
  if (/valor|r\$|pre[cç]o/.test(d)) return 'R$ 13.800,00'
  if (/kwh|consumo/.test(d)) return '600 kWh'
  if (/data|dia/.test(d)) return '17/11'
  if (/hora/.test(d)) return '10h'
  return 'exemplo'
}

/** Normaliza as variáveis salvas em 3 formatos diferentes → [{ index, description }] */
function normalizarVariaveis(v: unknown): { index: number; description: string }[] {
  if (Array.isArray(v)) {
    return v.map((x, i) => (x && typeof x === 'object' && 'index' in (x as object))
      ? { index: Number((x as { index: unknown }).index) || i + 1, description: String((x as { description?: unknown }).description ?? '') }
      : { index: i + 1, description: String(x ?? '') })
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, d]) => ({ index: Number(k) || 0, description: String(d ?? '') }))
      .filter((x) => x.index > 0).sort((a, b) => a.index - b.index)
  }
  return []
}

/**
 * Envia o template para APROVAÇÃO da Meta (antes era manual no Meta Business Manager).
 * POST /{WABA}/message_templates — depois o "Sync" acompanha o status (PENDING → APPROVED/REJECTED).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id } = await params
  const template = await prisma.whatsappTemplate.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template não encontrado.' }, { status: 404 })
  if (template.metaId && template.metaStatus && !['NAO_ENVIADO', 'REJECTED'].includes(template.metaStatus)) {
    return NextResponse.json({ error: `Este template já está na Meta (status: ${template.metaStatus}). Use o Sync.` }, { status: 400 })
  }

  const account = await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudWabaId: { not: null } } })
  if (!account?.cloudWabaId) return NextResponse.json({ error: 'Nenhuma conta Cloud API configurada com WABA ID.' }, { status: 400 })

  // Variáveis: a Meta exige {{1}}, {{2}}... em sequência e um exemplo para cada uma
  const usadas = [...new Set([...template.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  if (usadas.some((n, i) => n !== i + 1)) {
    return NextResponse.json({ error: 'As variáveis do texto precisam ser {{1}}, {{2}}, ... em sequência.' }, { status: 400 })
  }
  const descr = normalizarVariaveis(template.variables)
  const exemplos = usadas.map((n) => exemploDaVariavel(descr.find((d) => d.index === n)?.description ?? 'nome'))

  const body = {
    name: template.name,
    language: template.language || 'pt_BR',
    category: (template.category || 'MARKETING').toUpperCase(),
    components: [
      { type: 'BODY', text: template.bodyText, ...(exemplos.length ? { example: { body_text: [exemplos] } } : {}) },
    ],
  }

  const res = await fetch(`${GRAPH}/${account.cloudWabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string; error_user_title?: string } }
  if (!res.ok || !data.id) {
    const msg = data.error?.error_user_msg || data.error?.message || `Meta respondeu ${res.status}`
    return NextResponse.json({ error: `A Meta recusou o envio: ${msg}` }, { status: 400 })
  }

  const updated = await prisma.whatsappTemplate.update({
    where: { id },
    data: { metaId: data.id, metaStatus: data.status || 'PENDING', lastSyncAt: new Date() },
  })
  return NextResponse.json({ template: updated, metaStatus: updated.metaStatus })
}
