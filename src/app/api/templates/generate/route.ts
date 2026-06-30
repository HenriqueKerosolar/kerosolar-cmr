import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { context, actionType } = await req.json()
  if (!context?.trim()) return NextResponse.json({ error: 'Descreva o contexto do template.' }, { status: 400 })

  const cfgRows = await prisma.systemConfig.findMany({
    where: { key: { in: ['anthropic_key', 'openai_key', 'ai_provider', 'bot_name'] } },
  })
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]))
  const botName = cfg.bot_name || 'KeroSolar'

  const actionMap: Record<string, string> = {
    chegada_followup: 'follow-up para lead que acabou de chegar e não respondeu à saudação inicial',
    reengage: 'reengajamento de lead inativo há 10+ dias',
    budget_followup: 'follow-up para lead que recebeu orçamento mas não respondeu',
    budget_validity: 'lembrete de validade do orçamento (3 dias)',
    after_hours_resume: 'retomada de conversa no horário comercial após mensagem fora do horário',
  }
  const actionDesc = actionType ? actionMap[actionType] || actionType : 'reengajamento'

  const systemPrompt = `Você é especialista em copywriting para WhatsApp Business e nas regras de templates da Meta.

Crie um template de mensagem (HSM) para WhatsApp Business com as seguintes regras OBRIGATÓRIAS da Meta:
- Categoria: MARKETING
- Idioma: pt_BR
- Corpo (body): máximo 1024 caracteres
- Variáveis: use {{1}}, {{2}} etc. (somente números dentro de chaves duplas)
- Tom: cordial, natural, não robótico, sem spam
- Proibido: emojis em excesso, promessas enganosas, linguagem agressiva
- O texto deve passar na aprovação automática da Meta (sem gatilhos de spam)

Responda SOMENTE com um JSON válido no formato:
{
  "name": "nome_em_snake_case_sem_espacos",
  "displayName": "Nome Legível para o Painel",
  "bodyText": "Texto do template com {{1}} onde vai o nome do lead",
  "variables": [
    { "index": 1, "description": "Nome do lead" }
  ],
  "explanation": "Uma frase explicando o que o template faz e quando é enviado"
}`

  const userMsg = `Empresa: ${botName} (energia solar)
Contexto de uso: ${actionDesc}
Descrição adicional: ${context}

Crie o template seguindo as regras da Meta.`

  // Usa Anthropic se configurado, senão OpenAI
  const anthropicKey = cfg.anthropic_key || process.env.ANTHROPIC_API_KEY || ''
  const openaiKey = cfg.openai_key || process.env.OPENAI_API_KEY || ''

  let raw = ''

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    const data = await res.json() as { content?: Array<{ type: string; text: string }> }
    raw = data?.content?.[0]?.text?.trim() || ''
  } else if (openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
      }),
    })
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
    raw = data?.choices?.[0]?.message?.content?.trim() || ''
  } else {
    return NextResponse.json({ error: 'Nenhuma chave de IA configurada.' }, { status: 400 })
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'IA não gerou um JSON válido.' }, { status: 500 })

  try {
    const result = JSON.parse(jsonMatch[0])
    return NextResponse.json({ template: result })
  } catch {
    return NextResponse.json({ error: 'Erro ao parsear resposta da IA.' }, { status: 500 })
  }
}
