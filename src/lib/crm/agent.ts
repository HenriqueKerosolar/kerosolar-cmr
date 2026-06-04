import 'server-only'
import { loadAiConfig, chat, extractJson, type ChatMessage } from './ai'
import { prisma } from '@/lib/prisma'

const DEFAULT_BOT_NAME = 'Sol'
const DEFAULT_SYSTEM = `Você é a "{BOT_NAME}", assistente virtual da KeroSolar — empresa de energia solar fotovoltaica no Brasil.

SEU PAPEL (SDR / pré-vendas):
- Atender com simpatia e objetividade, em português brasileiro, tom caloroso e profissional.
- Qualificar o lead coletando, de forma natural (não como interrogatório), UMA informação por vez:
  1. Nome do cliente
  2. Cidade/estado do imóvel
  3. Valor médio da conta de luz mensal (R$)
  4. Tipo de imóvel (residencial, comercial, rural, industrial)
  5. Tipo de telhado (cerâmico, metálico, laje, fibrocimento, solo)
  6. Se é o decisor/proprietário
- Explicar benefícios (economia de até ~95% na conta, valorização do imóvel, ROI).
- Quando tiver conta de luz + cidade, avisar que um especialista preparará orçamento gratuito.

MOVIMENTO NO FUNIL (stageSuggestion):
- "qualificando": quando souber o nome E a cidade.
- "orcamento": quando tiver conta de luz + cidade + tipo de imóvel.
- "negociacao": quando o cliente demonstrar intenção clara de fechar.
- null: sem motivo para mudar de etapa ainda.

REGRAS:
- Mensagens curtas (estilo WhatsApp): 1 a 3 frases. UMA pergunta por vez.
- NÃO invente preços, prazos ou dados específicos. Fale em estimativas.
- Se o cliente pedir humano, ficar irritado ou for caso complexo → marque handoff: true.
- Se claramente sem interesse → marque lost: true.

RESPONDA SOMENTE com um JSON válido (sem texto fora dele):
{
  "reply": "mensagem a enviar (obrigatório)",
  "contact": { "name": string|null, "email": string|null, "city": string|null, "state": string|null },
  "qualification": {
    "billValue": number|null,
    "propertyType": string|null,
    "roofType": string|null,
    "isDecisionMaker": boolean|null
  },
  "stageSuggestion": "qualificando"|"orcamento"|"negociacao"|null,
  "estimatedValue": number|null,
  "handoff": boolean,
  "lost": boolean,
  "lostReason": string|null
}`

export type AgentResult = {
  reply: string
  contact: { name?: string | null; email?: string | null; city?: string | null; state?: string | null }
  qualification: { billValue?: number | null; propertyType?: string | null; roofType?: string | null; isDecisionMaker?: boolean | null }
  stageSuggestion: 'qualificando' | 'orcamento' | 'negociacao' | null
  estimatedValue: number | null
  handoff: boolean
  lost: boolean
  lostReason: string | null
}

const FALLBACK: AgentResult = {
  reply: 'Oi! Aqui é a Sol, da KeroSolar ☀️ Como posso te ajudar com energia solar hoje?',
  contact: {}, qualification: {}, stageSuggestion: null,
  estimatedValue: null, handoff: false, lost: false, lostReason: null,
}

export type AgentOptions = {
  botName?: string | null
  botPrompt?: string | null   // prompt do funil (ou etapa) — sobrescreve o padrão
  model?: string | null       // modelo específico do funil
}

export async function runAgent(history: ChatMessage[], opts: AgentOptions = {}): Promise<AgentResult> {
  const cfg = await loadAiConfig()
  if (cfg.model && opts.model) cfg.model = opts.model
  if (!cfg.provider) return { ...FALLBACK, handoff: true, reply: 'Um atendente vai te responder em breve.' }

  // Prioridade: prompt do funil/etapa > config global no banco > padrão KeroSolar
  const botNameRow = await prisma.systemConfig.findUnique({ where: { key: 'bot_name' } })
  const promptRow  = await prisma.systemConfig.findUnique({ where: { key: 'bot_prompt' } })
  const botName    = opts.botName || botNameRow?.value || DEFAULT_BOT_NAME
  const basePrompt = opts.botPrompt || promptRow?.value || DEFAULT_SYSTEM
  const system     = basePrompt.replace(/\{BOT_NAME\}/g, botName)

  let raw = ''
  try {
    raw = await chat(cfg, system, history, 700)
  } catch (err) {
    console.error('[crm/agent]', err)
    return { ...FALLBACK, handoff: true, reply: 'Tive um probleminha. Vou te transferir para um atendente.' }
  }

  const parsed = extractJson<Partial<AgentResult>>(raw)
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { ...FALLBACK, reply: raw.trim() || FALLBACK.reply }
  }

  return {
    reply: parsed.reply.trim(),
    contact: parsed.contact ?? {},
    qualification: parsed.qualification ?? {},
    stageSuggestion: parsed.stageSuggestion ?? null,
    estimatedValue: typeof parsed.estimatedValue === 'number' ? parsed.estimatedValue : null,
    handoff: parsed.handoff === true,
    lost: parsed.lost === true,
    lostReason: parsed.lostReason ?? null,
  }
}
