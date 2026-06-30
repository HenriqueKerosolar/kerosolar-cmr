import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runAgent } from '@/lib/crm/agent'
import type { ChatMessage } from '@/lib/crm/ai'

type ReqBody = {
  action: 'start' | 'message' | 'set-whatsapp'
  convId?: string
  visitorName?: string
  visitorEmail?: string
  message?: string
  whatsapp?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody

    if (body.action === 'start') {
      // Criar nova conversa do site
      if (!body.visitorName) return NextResponse.json({ error: 'Nome obrigatório.' }, { status: 400 })

      // Criar contato temporário para o visitante
      const contact = await prisma.contact.create({
        data: {
          name: body.visitorName,
          email: body.visitorEmail || null,
          phone: null,
        },
      })

      // Buscar ou criar pipeline padrão
      let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } })
      if (!pipeline) {
        pipeline = await prisma.pipeline.create({
          data: {
            name: 'Padrão',
            isDefault: true,
          },
        })
      }

      // Buscar ou criar stage "Entrou pelo Site"
      let stage = await prisma.stage.findFirst({
        where: { pipelineId: pipeline.id, name: 'Entrou pelo Site' },
      })
      if (!stage) {
        stage = await prisma.stage.create({
          data: {
            pipelineId: pipeline.id,
            name: 'Entrou pelo Site',
            color: '#10b981', // verde
            sortOrder: 0,
          },
        })
      }

      // Criar lead na etapa "Entrou pelo Site"
      const lead = await prisma.lead.create({
        data: {
          title: body.visitorName, // título do lead (obrigatório)
          contactId: contact.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          status: 'open',
          source: 'webchat',
        },
      })

      // Criar conversa vinculada ao lead
      const conv = await prisma.conversation.create({
        data: {
          channel: 'webchat',
          contactId: contact.id,
          leadId: lead.id,
          messages: {
            create: {
              direction: 'inbound',
              senderType: 'contact',
              content: `Visitante do site: ${body.visitorName}`,
            },
          },
        },
        include: { messages: true },
      })

      return NextResponse.json({ ok: true, convId: conv.id, leadId: lead.id })
    }

    if (body.action === 'message') {
      // Receber mensagem do chat do site
      if (!body.convId || !body.message) {
        return NextResponse.json({ error: 'convId e message obrigatórios.' }, { status: 400 })
      }

      const conv = await prisma.conversation.findUnique({
        where: { id: body.convId },
        include: { lead: { include: { pipeline: true } } },
      })
      if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })

      // 1) salva a mensagem do visitante
      await prisma.message.create({
        data: {
          conversationId: body.convId,
          direction: 'inbound',
          senderType: 'contact',
          content: body.message,
        },
      })
      await prisma.conversation.update({ where: { id: body.convId }, data: { lastMessageAt: new Date() } })

      // 2) roda a IA (o MESMO agente do WhatsApp) com o histórico
      const msgs = await prisma.message.findMany({
        where: { conversationId: body.convId },
        orderBy: { createdAt: 'asc' },
        take: 40,
      })
      const history: ChatMessage[] = msgs.map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.content,
      }))
      const pipeline = conv.lead?.pipeline
      const leadCf = (conv.lead?.customFields as Record<string, unknown> | null) ?? null
      const SITE_RULES = `## REGRAS DO CHAT DO SITE (PRIORIDADE MÁXIMA):
- É TERMINANTEMENTE PROIBIDO pedir CPF, data de nascimento, CEP ou os dados de financiamento por conta própria. Só peça esses 5 dados SE o cliente disser CLARAMENTE que quer FAZER/TENTAR O FINANCIAMENTO (ex.: "quero financiar", "quero parcelar", "como faço pra financiar"). Receber o orçamento, demonstrar interesse, dizer "quero seguir" ou mandar um número de telefone NÃO é pedir financiamento — nesse caso NUNCA peça esses dados.
- Atenda normalmente: responda dúvidas, apresente o orçamento e pode citar as formas de pagamento de forma geral; mas só colete os dados de financiamento quando o cliente PEDIR o financiamento explicitamente.`
      const result = await runAgent(history, {
        botName: pipeline?.botName,
        botPrompt: pipeline?.botPrompt,
        model: pipeline?.aiModel,
        lead: leadCf,
        extraRules: SITE_RULES,
      })

      // 3) Se a IA captou o consumo, calcula o ORÇAMENTO REAL (mesma calculadora do
      //    WhatsApp: solar-calc) e roda a IA de novo com os números corretos injetados.
      const q = result.qualification ?? {}
      // Reforço por regex: pega "1000 kwh" / "R$ 500" / "500 reais" direto da mensagem,
      // caso a IA não tenha colocado no JSON (mais confiável p/ disparar o orçamento).
      const reKwh = body.message.match(/(\d{2,6})\s*k\s*wh/i)
      const reReais = body.message.match(/r\$\s*([\d.]{2,8})/i) || body.message.match(/(\d{2,6})\s*reais/i)
      const consumoKwh = (typeof q.consumoKwh === 'number' ? q.consumoKwh : null) ?? (reKwh ? Number(reKwh[1]) : null)
      const billValue = (typeof q.billValue === 'number' ? q.billValue : null) ?? (reReais ? Number(reReais[1].replace(/\./g, '')) : null)
      let finalReply = result.reply
      let handoff = result.handoff
      let solar: ReturnType<typeof import('@/lib/crm/solar-calc').calcularSolar> | null = null

      if ((consumoKwh || billValue) && !leadCf?.solar) {
        const sc = await import('@/lib/crm/solar-calc')
        await sc.carregarTabelaFinanciamento().catch(() => {})
        solar = consumoKwh ? sc.calcularSolarPorKwh(consumoKwh) : sc.calcularSolar(billValue as number)
        if (solar) {
          const estimate = solar.baixoConsumo
            ? `O consumo é baixo (~${solar.consumoKwh} kWh/mês). Ofereça o KIT DE ENTRADA de 300 kWh por R$ 7.670 (instalado e homologado), conforme a regra de consumo baixo. NÃO invente outros números.`
            : sc.resumoParaIA(solar)
          const r2 = await runAgent(history, {
            botName: pipeline?.botName,
            botPrompt: pipeline?.botPrompt,
            model: pipeline?.aiModel,
            estimate,
            lead: leadCf,
            extraRules: SITE_RULES,
          })
          finalReply = r2.reply
          handoff = r2.handoff
        }
      }

      // 4) salva a resposta da IA
      await prisma.message.create({
        data: {
          conversationId: body.convId,
          direction: 'outbound',
          senderType: 'ai',
          content: finalReply,
        },
      })

      // 5) persiste consumo/orçamento no lead (pra não recalcular nem pedir de novo)
      if (conv.leadId && (consumoKwh || billValue || solar)) {
        await prisma.lead.update({
          where: { id: conv.leadId },
          data: {
            customFields: {
              ...(leadCf ?? {}),
              ...(consumoKwh ? { consumoKwh } : {}),
              ...(billValue ? { billValue } : {}),
              ...(solar ? { solar: solar as object } : {}),
            },
            ...(solar ? { value: solar.valorSistema } : {}),
          },
        })
      }

      return NextResponse.json({ ok: true, reply: finalReply, handoff })
    }

    if (body.action === 'set-whatsapp') {
      // Visitor forneceu WhatsApp — atualiza contato
      if (!body.convId || !body.whatsapp) {
        return NextResponse.json({ error: 'convId e whatsapp obrigatórios.' }, { status: 400 })
      }

      const conv = await prisma.conversation.findUnique({ where: { id: body.convId }, include: { contact: true } })
      if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })

      // Atualiza o telefone do contato
      await prisma.contact.update({
        where: { id: conv.contactId },
        data: { phone: body.whatsapp },
      })

      // Registra a mensagem de telefone fornecido
      await prisma.message.create({
        data: {
          conversationId: body.convId,
          direction: 'inbound',
          senderType: 'contact',
          content: `📱 Telefone: ${body.whatsapp}`,
        },
      })

      return NextResponse.json({ ok: true, convId: body.convId })
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (err) {
    console.error('Chat site error:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
