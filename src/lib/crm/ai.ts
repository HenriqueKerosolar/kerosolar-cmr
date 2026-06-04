import 'server-only'
import { prisma } from '@/lib/prisma'

export type AiConfig = {
  provider: 'anthropic' | 'openai' | null
  anthropicKey: string
  openaiKey: string
  model: string
}

export async function loadAiConfig(): Promise<AiConfig> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['ai_provider', 'anthropic_key', 'openai_key', 'ai_model'] } },
  })
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const anthropicKey = cfg['anthropic_key'] || process.env.ANTHROPIC_API_KEY || ''
  const openaiKey    = cfg['openai_key']    || process.env.OPENAI_API_KEY    || ''

  let provider: 'anthropic' | 'openai' | null = null
  if (cfg['ai_provider'] === 'anthropic' && anthropicKey) provider = 'anthropic'
  else if (cfg['ai_provider'] === 'openai' && openaiKey)  provider = 'openai'
  else if (anthropicKey) provider = 'anthropic'
  else if (openaiKey)    provider = 'openai'

  const model = cfg['ai_model'] || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022')
  return { provider, anthropicKey, openaiKey, model }
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function chat(
  cfg: AiConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 1024,
): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? ''
  }
  if (cfg.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  }
  throw new Error('IA não configurada.')
}

export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start === -1 || end < start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) as T } catch { return null }
}
