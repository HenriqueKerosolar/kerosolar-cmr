import 'server-only'
import { NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'

export async function POST(req: Request) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { text } = await req.json() as { text?: string }
  if (!text?.trim()) return NextResponse.json({ error: 'Texto vazio.' }, { status: 400 })

  try {
    const { loadAiConfig, chat } = await import('@/lib/crm/ai')
    const cfg = await loadAiConfig()

    const response = await chat(cfg, 'Você é um assistente de formatação de mensagens. Sua tarefa é melhorar textos deixando-os visualmente apresentáveis.', [
      {
        role: 'user',
        content: `Formate e melhore este texto para uma mensagem profissional. Deixe visualmente apresentável com quebras de linha, parágrafos bem separados e estrutura clara. Mantenha o sentido e conteúdo, apenas melhore a apresentação, formatação e ortografia. Retorne APENAS o texto formatado, sem explicações:\n\n"${text}"`,
      },
    ])

    const improved = response?.trim() || text
    return NextResponse.json({ formatted: improved })
  } catch (err) {
    console.error('[format-text] erro:', err)
    return NextResponse.json({ error: 'Erro ao formatar texto.' }, { status: 500 })
  }
}
