// 🚫 Lead descartado (spam / fora do perfil) → entra no público "CRM - Excluir dos anúncios" da Meta (dono,
// 28/11/2026: "bloquear essa pessoa para não clicar mais no meu anúncio"). O público é uma Lista de Clientes
// (telefone em SHA-256, como a Meta exige — o número nunca vai em texto). Nos conjuntos de anúncios, o dono marca
// esse público em "Excluir" uma vez; daí em diante cada descartado sai sozinho dos anúncios.
// Precisa de META_ADS_TOKEN (usuário do sistema com ads_management) e META_AD_ACCOUNT_ID. Sem eles: não faz nada.
import 'server-only'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const NOME_PUBLICO = 'CRM - Excluir dos anúncios'
const CHAVE_CONFIG = 'meta_publico_excluir'

/** Telefone no formato da Meta (só dígitos, com DDI 55) em SHA-256. null se não parece telefone. */
export function hashTelefone(telefone: string | null | undefined): string | null {
  let d = (telefone || '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  if (d.length < 12 || d.length > 13) return null
  return createHash('sha256').update(d).digest('hex')
}

function graph(): { base: string; token: string; conta: string } | null {
  const token = process.env.META_ADS_TOKEN?.trim()
  const conta = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, '')
  if (!token || !conta) return null
  return { base: `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`, token, conta }
}

async function publicoId(g: NonNullable<ReturnType<typeof graph>>): Promise<string> {
  const salvo = await prisma.systemConfig.findUnique({ where: { key: CHAVE_CONFIG } })
  if (salvo?.value) return salvo.value
  const r = await fetch(`${g.base}/act_${g.conta}/customaudiences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.token}` },
    body: JSON.stringify({
      name: NOME_PUBLICO, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY',
      description: 'Leads descartados no KeroSolar CRM (spam / fora do perfil). Use em "Excluir" nos conjuntos de anúncios.',
    }),
  })
  const j = await r.json() as { id?: string; error?: { message?: string } }
  if (!r.ok || !j.id) throw new Error(`Meta não criou o público: ${j.error?.message ?? r.status}`)
  await prisma.systemConfig.upsert({ where: { key: CHAVE_CONFIG }, create: { key: CHAVE_CONFIG, value: j.id }, update: { value: j.id } })
  return j.id
}

/** Põe o telefone no público de exclusão. Nunca lança: devolve o que aconteceu (para a nota do lead). */
export async function excluirDosAnuncios(telefone: string | null | undefined): Promise<'ok' | 'sem-token' | 'sem-telefone' | 'erro'> {
  const g = graph()
  if (!g) return 'sem-token'
  const h = hashTelefone(telefone)
  if (!h) return 'sem-telefone'
  try {
    const id = await publicoId(g)
    const r = await fetch(`${g.base}/${id}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.token}` },
      body: JSON.stringify({ payload: { schema: 'PHONE', data: [h] } }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({})) as { error?: { message?: string } }
      console.error('[meta excluir] falhou:', j.error?.message ?? r.status)
      return 'erro'
    }
    return 'ok'
  } catch (e) {
    console.error('[meta excluir] erro:', e instanceof Error ? e.message : e)
    return 'erro'
  }
}

/** Texto para a nota do lead. */
export function notaExclusao(r: Awaited<ReturnType<typeof excluirDosAnuncios>>): string | null {
  if (r === 'ok') return `🚫 Telefone incluído no público "${NOME_PUBLICO}" da Meta (não vê mais os anúncios onde esse público estiver excluído).`
  if (r === 'erro') return '⚠️ Não consegui incluir o telefone no público de exclusão dos anúncios (Meta recusou — veja o log).'
  return null
}
