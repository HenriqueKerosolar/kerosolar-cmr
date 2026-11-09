import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Recebe leads do formulário do site kerosolar.com.br.
 * POST /api/public/lead-form
 * Header: x-api-key = WEBCHAT_API_KEY
 * Body: { name, phone?, email?, city?, contactPreference?, message?, source? }
 */

const ALLOWED_ORIGIN = process.env.WEBCHAT_ORIGIN || '*'

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
  return res
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

function checkKey(req: NextRequest): boolean {
  const key = process.env.WEBCHAT_API_KEY
  if (!key) return true
  return req.headers.get('x-api-key') === key
}

const limpa = (v: unknown, max: number) =>
  (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '') || null

export async function POST(req: NextRequest) {
  if (!checkKey(req)) return cors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return cors(NextResponse.json({ error: 'json inválido' }, { status: 400 })) }

  const nome = limpa(body.name, 120)
  if (!nome) return cors(NextResponse.json({ error: 'name obrigatório' }, { status: 400 }))

  const telefone = limpa(body.phone, 30)
  const email    = limpa(body.email, 160)
  const cidade   = limpa(body.city, 80)
  const preferencia = limpa(body.contactPreference, 40)
  const mensagem = limpa(body.message, 2000)
  const origem   = limpa(body.source, 80) ?? 'formulario-site'

  try {
    const contact = await prisma.contact.create({
      data: { name: nome, phone: telefone, email },
    })

    let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } })
    if (!pipeline) {
      pipeline = await prisma.pipeline.create({ data: { name: 'Padrão', isDefault: true } })
    }

    let stage = await prisma.stage.findFirst({ where: { pipelineId: pipeline.id, name: 'Entrou pelo Site' } })
    if (!stage) {
      stage = await prisma.stage.create({
        data: { pipelineId: pipeline.id, name: 'Entrou pelo Site', color: '#10b981', sortOrder: 0 },
      })
    }

    const campos: Record<string, unknown> = {}
    if (cidade)     campos.city = cidade
    if (preferencia) campos.preferencia_contato = preferencia
    if (mensagem)   campos.mensagem = mensagem
    if (origem)     campos.origem = origem

    const lead = await prisma.lead.create({
      data: {
        title: nome,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        status: 'open',
        source: 'site',
        customFields: Object.keys(campos).length ? campos as object : undefined,
      },
    })

    return cors(NextResponse.json({ ok: true, leadId: lead.id }))
  } catch (err) {
    console.error('[lead-form POST]', err)
    return cors(NextResponse.json({ error: 'erro ao criar lead' }, { status: 500 }))
  }
}
