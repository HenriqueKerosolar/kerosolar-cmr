// Envio de template para aprovação da Meta (antes ficava só na rota). 16/11/2026: suporte a CABEÇALHO
// com arquivo (DOCUMENT/IMAGE) — o ebook em PDF vai anexado no topo da mensagem. A Meta exige um
// arquivo de exemplo enviado pela API de upload do app (header_handle) para analisar o template.
import 'server-only'
import { prisma } from '@/lib/prisma'

const GRAPH = 'https://graph.facebook.com/v23.0'
const token = () => process.env.WHATSAPP_CLOUD_TOKEN || ''

/** Exemplos que a Meta exige para cada variável {{n}} do corpo (usados só na análise da Meta). */
function exemploDaVariavel(descricao: string): string {
  // descrição com exemplo explícito: "texto livre (ex.: Kit de 4,34 kWp ...)" → usa o exemplo (a Meta analisa)
  const ex = /\(ex\.?:\s*([^)]+)\)/i.exec(descricao)
  if (ex) return ex[1].trim()
  const d = descricao.toLowerCase()
  if (/nome|lead|cliente/.test(d)) return 'Maria'
  if (/valor|r\$|pre[cç]o/.test(d)) return 'R$ 13.800,00'
  if (/kwh|consumo/.test(d)) return '600 kWh'
  if (/data|dia/.test(d)) return '17/11'
  if (/hora/.test(d)) return '10h'
  return 'exemplo'
}

/** Normaliza as variáveis salvas em 3 formatos diferentes → [{ index, description }] */
export function normalizarVariaveis(v: unknown): { index: number; description: string }[] {
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

/** Sobe o arquivo de exemplo na API de upload do app (Resumable Upload) e devolve o handle. */
async function handleDoArquivo(url: string): Promise<string> {
  const arq = await fetch(url)
  if (!arq.ok) throw new Error(`não consegui baixar o arquivo do cabeçalho (${arq.status}) em ${url}`)
  const bytes = Buffer.from(await arq.arrayBuffer())
  const tipo = arq.headers.get('content-type')?.split(';')[0] || 'application/pdf'

  const app = await fetch(`${GRAPH}/app?access_token=${encodeURIComponent(token())}`).then((r) => r.json()) as { id?: string; error?: { message?: string } }
  if (!app.id) throw new Error(`não achei o app da Meta pelo token: ${app.error?.message ?? 'sem id'}`)

  const nome = decodeURIComponent(url.split('/').pop() || 'arquivo.pdf')
  const sessao = await fetch(`${GRAPH}/${app.id}/uploads?file_name=${encodeURIComponent(nome)}&file_length=${bytes.length}&file_type=${encodeURIComponent(tipo)}&access_token=${encodeURIComponent(token())}`, { method: 'POST' })
    .then((r) => r.json()) as { id?: string; error?: { message?: string } }
  if (!sessao.id) throw new Error(`a Meta recusou abrir o upload: ${sessao.error?.message ?? 'sem id'}`)

  const up = await fetch(`${GRAPH}/${sessao.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token()}`, file_offset: '0' },
    body: bytes,
  }).then((r) => r.json()) as { h?: string; error?: { message?: string } }
  if (!up.h) throw new Error(`a Meta recusou o arquivo de exemplo: ${up.error?.message ?? 'sem handle'}`)
  return up.h
}

/**
 * Envia o template para APROVAÇÃO da Meta. POST /{WABA}/message_templates — depois o "Sync" acompanha o
 * status (PENDING → APPROVED/REJECTED). Lança Error com mensagem legível em caso de recusa.
 */
export async function submeterTemplate(id: string) {
  const template = await prisma.whatsappTemplate.findUnique({ where: { id } })
  if (!template) throw new Error('Template não encontrado.')
  if (template.metaId && template.metaStatus && !['NAO_ENVIADO', 'REJECTED'].includes(template.metaStatus)) {
    throw new Error(`Este template já está na Meta (status: ${template.metaStatus}). Use o Sync.`)
  }
  const account = await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudWabaId: { not: null } } })
  if (!account?.cloudWabaId) throw new Error('Nenhuma conta Cloud API configurada com WABA ID.')

  // Variáveis: a Meta exige {{1}}, {{2}}... em sequência e um exemplo para cada uma
  const usadas = [...new Set([...template.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  if (usadas.some((n, i) => n !== i + 1)) throw new Error('As variáveis do texto precisam ser {{1}}, {{2}}, ... em sequência.')
  const descr = normalizarVariaveis(template.variables)
  const exemplos = usadas.map((n) => exemploDaVariavel(descr.find((d) => d.index === n)?.description ?? 'nome'))

  const components: object[] = []
  if ((template.headerType === 'DOCUMENT' || template.headerType === 'IMAGE') && template.headerUrl) {
    components.push({ type: 'HEADER', format: template.headerType, example: { header_handle: [await handleDoArquivo(template.headerUrl)] } })
  }
  components.push({ type: 'BODY', text: template.bodyText, ...(exemplos.length ? { example: { body_text: [exemplos] } } : {}) })

  const res = await fetch(`${GRAPH}/${account.cloudWabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: template.name,
      language: template.language || 'pt_BR',
      category: (template.category || 'MARKETING').toUpperCase(),
      components,
    }),
  })
  const data = await res.json().catch(() => ({})) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } }
  if (!res.ok || !data.id) throw new Error(`A Meta recusou o envio: ${data.error?.error_user_msg || data.error?.message || `Meta respondeu ${res.status}`}`)

  return prisma.whatsappTemplate.update({
    where: { id },
    data: { metaId: data.id, metaStatus: data.status || 'PENDING', lastSyncAt: new Date() },
  })
}

/** Componentes de ENVIO de um template: cabeçalho com o arquivo (se tiver) + variáveis do corpo. */
export function componentesDeEnvio(t: { headerType: string | null; headerUrl: string | null; headerFilename: string | null }, corpo: string[]): object[] {
  const comps: object[] = []
  if (t.headerType === 'DOCUMENT' && t.headerUrl) {
    comps.push({ type: 'header', parameters: [{ type: 'document', document: { link: t.headerUrl, filename: t.headerFilename || 'arquivo.pdf' } }] })
  } else if (t.headerType === 'IMAGE' && t.headerUrl) {
    comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: t.headerUrl } }] })
  }
  if (corpo.length) comps.push({ type: 'body', parameters: corpo.map((text) => ({ type: 'text', text })) })
  return comps
}
