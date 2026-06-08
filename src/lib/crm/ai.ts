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

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  imageBase64?: string   // base64 da imagem (jpeg/png/webp) — só na última msg do usuário
  imageMediaType?: string
}

export async function chat(
  cfg: AiConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 1024,
): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const apiMsgs = messages.map((m) => {
      if (m.role === 'user' && m.imageBase64) {
        return {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: m.imageMediaType ?? 'image/jpeg', data: m.imageBase64 } },
            { type: 'text', text: m.content || 'Analise esta conta de luz e extraia os dados para o orçamento solar.' },
          ],
        }
      }
      return { role: m.role, content: m.content }
    })
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: apiMsgs }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? ''
  }
  if (cfg.provider === 'openai') {
    const apiMsgs = [
      { role: 'system', content: system },
      ...messages.map((m) => {
        if (m.role === 'user' && m.imageBase64) {
          return {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${m.imageMediaType ?? 'image/jpeg'};base64,${m.imageBase64}` } },
              { type: 'text', text: m.content || 'Analise esta conta de luz e extraia os dados para o orçamento solar.' },
            ],
          }
        }
        return { role: m.role, content: m.content }
      }),
    ]
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: apiMsgs }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  }
  throw new Error('IA não configurada.')
}

/**
 * Extrai dados estruturados de uma imagem de conta de luz via visão da IA.
 * Retorna os campos que conseguiu ler; campos não encontrados vêm como null.
 */
export async function extractBillFromImage(
  cfg: AiConfig,
  imageBase64: string,
  imageMediaType = 'image/jpeg',
): Promise<{ kwh: number | null; valor: number | null; medidor: string | null; distribuidora: string | null; isIdentityDoc: boolean }> {
  const fallback = { kwh: null, valor: null, medidor: null, distribuidora: null, isIdentityDoc: false }
  const prompt = `Você é um leitor de documentos. Analise a imagem e extraia:
1. consumo em kWh (número médio mensal ou do mês atual) — SOMENTE se for conta de luz/energia
2. valor total a pagar em R$ — SOMENTE se for conta de luz/energia
3. tipo de medidor/ligação: "monofásico", "bifásico" ou "trifásico" — SOMENTE se for conta de luz
4. nome da distribuidora (Enel, Light, CPFL, Cemig, Copel, Energisa, etc.) — SOMENTE se for conta de luz
5. docType: "bill" se for conta de energia/luz, "identity" se for RG, CNH, carteira de identidade, CPF físico ou passaporte, "other" para qualquer outro documento

Responda SOMENTE com JSON válido, sem texto fora dele:
{"kwh": number|null, "valor": number|null, "medidor": string|null, "distribuidora": string|null, "docType": "bill"|"identity"|"other"}`

  try {
    let raw = ''
    if (cfg.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: cfg.model, max_tokens: 256,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ]}],
        }),
      })
      if (!res.ok) return fallback
      raw = (await res.json()).content?.[0]?.text ?? ''
    } else if (cfg.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify({
          model: cfg.model, max_tokens: 256,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } },
            { type: 'text', text: prompt },
          ]}],
        }),
      })
      if (!res.ok) return fallback
      raw = (await res.json()).choices?.[0]?.message?.content ?? ''
    }
    const parsed = extractJson<typeof fallback>(raw)
    if (!parsed) return fallback
    return {
      kwh:           typeof parsed.kwh === 'number'          ? parsed.kwh           : null,
      valor:         typeof parsed.valor === 'number'        ? parsed.valor         : null,
      medidor:       typeof parsed.medidor === 'string'      ? parsed.medidor       : null,
      distribuidora: typeof parsed.distribuidora === 'string' ? parsed.distribuidora : null,
      isIdentityDoc: parsed.docType === 'identity',
    }
  } catch { return fallback }
}

/**
 * Transcreve um arquivo de áudio usando OpenAI Whisper.
 * Retorna o texto transcrito ou null se falhar.
 * Usa sempre a chave OpenAI (mesmo que o provider principal seja Anthropic).
 */
export async function transcribeAudio(
  cfg: AiConfig,
  audioBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  if (!cfg.openaiKey) return null
  try {
    const ext = mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('webm') ? 'webm'
      : mimeType.includes('wav') ? 'wav'
      : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
      : 'mp3'
    const fd = new FormData()
    fd.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`)
    fd.append('model', 'whisper-1')
    fd.append('language', 'pt')   // prioriza português, mas Whisper detecta outros idiomas automaticamente
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.openaiKey}` },
      body: fd,
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.text === 'string' ? data.text.trim() || null : null
  } catch {
    return null
  }
}

export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start === -1 || end < start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) as T } catch { return null }
}
