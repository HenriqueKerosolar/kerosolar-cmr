import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runAgent } from '@/lib/crm/agent'
import type { ChatMessage } from '@/lib/crm/ai'

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

    let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true }, select: { id: true, botName: true, botPrompt: true, aiModel: true } })
    if (!pipeline) {
      pipeline = await prisma.pipeline.create({ data: { name: 'Padrão', isDefault: true }, select: { id: true, botName: true, botPrompt: true, aiModel: true } })
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
        source: 'webchat',
        customFields: Object.keys(campos).length ? campos as object : undefined,
      },
    })

    // Cria conversa + mensagem inbound para aparecer no chat do lead
    const linhas: string[] = [`📋 Lead recebido pelo formulário do site`]
    if (telefone)    linhas.push(`📱 Telefone: ${telefone}`)
    if (email)       linhas.push(`✉️ E-mail: ${email}`)
    if (cidade)      linhas.push(`📍 Cidade: ${cidade}`)
    if (preferencia) linhas.push(`💬 Preferência de contato: ${preferencia}`)
    if (mensagem)    linhas.push(`\n${mensagem}`)
    const conteudo = linhas.join('\n')
    const now = new Date()
    const conv = await prisma.conversation.upsert({
      where: { channel_contactId: { channel: 'webchat', contactId: contact.id } },
      create: { leadId: lead.id, contactId: contact.id, channel: 'webchat', lastMessageAt: now, resolvedAt: now },
      update: { leadId: lead.id, lastMessageAt: now, resolvedAt: now },
    })
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'inbound',
        senderType: 'contact',
        content: conteudo,
        isRead: false,
        createdAt: now,
      },
    })

    // Nota na timeline para aparecer em qualquer canal futuro (WhatsApp, etc.)
    await prisma.note.create({
      data: { leadId: lead.id, type: 'system', content: conteudo },
    })

    // Resposta automática da IA apenas se a mensagem já traz um pedido claro
    // (kWh de consumo ou valor da conta de luz mencionados)
    const temPedidoClaro = !!mensagem && (
      /\d{2,6}\s*k\s*wh/i.test(mensagem) ||
      /r\$\s*[\d.,]{2,8}/.test(mensagem) ||
      /\d{2,6}\s*reais/i.test(mensagem)
    )
    if (temPedidoClaro) {
      try {
        const history: ChatMessage[] = [{ role: 'user', content: mensagem }]
        const leadCf = Object.keys(campos).length ? campos : null
        const sc = await import('@/lib/crm/solar-calc')
        await sc.carregarTabelaFinanciamento().catch(() => {})
        const reKwh = mensagem.match(/(\d{2,6})\s*k\s*wh/i)
        const reReais = mensagem.match(/r\$\s*([\d.]{2,8})/i) || mensagem.match(/(\d{2,6})\s*reais/i)
        const consumoKwh = reKwh ? Number(reKwh[1]) : null
        const billValue = reReais ? Number(reReais[1].replace(/\./g, '')) : null
        const solar = consumoKwh ? sc.calcularSolarPorKwh(consumoKwh) : billValue ? sc.calcularSolar(billValue) : null
        const estimate = solar
          ? (solar.baixoConsumo
            ? `O consumo é baixo (~${solar.consumoKwh} kWh/mês). Ofereça o KIT DE ENTRADA de 300 kWh por R$ 7.670 (instalado e homologado), conforme a regra de consumo baixo. NÃO invente outros números.`
            : sc.resumoParaIA(solar))
          : undefined
        const result = await runAgent(history, {
          botName: pipeline.botName,
          botPrompt: pipeline.botPrompt,
          model: pipeline.aiModel,
          lead: leadCf,
          estimate,
        })
        await prisma.message.create({
          data: { conversationId: conv.id, direction: 'outbound', senderType: 'ai', content: result.reply },
        })
        if (solar) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { customFields: { ...campos, solar: solar as object }, value: solar.valorSistema },
          })
        }
      } catch (e) {
        console.error('[lead-form IA]', e instanceof Error ? e.message : e)
      }
    }

    return cors(NextResponse.json({ ok: true, leadId: lead.id }))
  } catch (err) {
    console.error('[lead-form POST]', err)
    return cors(NextResponse.json({ error: 'erro ao criar lead' }, { status: 500 }))
  }
}
