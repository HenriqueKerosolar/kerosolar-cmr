import 'server-only'
// 📄 PDF do FORNECEDOR → orçamento KeroSolar (dono, 24/11/2026). Uso principal: HÍBRIDO (o robô Belenus só faz on-grid).
// O operador anexa no CRM o PDF do orçamento do fornecedor com a legenda "orça esse" (ou "orça esse 45%").
// O PDF do fornecedor NUNCA vai ao cliente (tem o preço de custo). A IA lê itens e total; o CRM aplica a margem
// (híbrido 50% → × 1,5; on-grid 60% → × 1,6; ou a do comando), gera o PDF KeroSolar e deixa SÓ para o operador.
// Vai ao cliente quando o operador escrever "envia orçamento" (a leitura é feita por IA: conferir antes).

import { extractJson, loadAiConfig } from '../ai'
import type { Peca, ResultadoCotacao } from './regras'

export const MARGEM_HIBRIDO = 0.5
export const MARGEM_ONGRID = 0.6

/** Legenda INTEIRA: "orça esse", "orçar este", "orca isso 45%", "orça esse com 45%". */
export function lerComandoOrcaEsse(legenda: string): { margem: number | null } | null {
  const t = (legenda || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const m = t.match(/^orca(?:r)?\s+(?:esse|este|isso|esse\s+orcamento|este\s+orcamento)(?:\s+(?:com\s+)?(\d{1,3}(?:[.,]\d+)?)\s*%)?\s*[.!]?$/)
  if (!m) return null
  const margem = m[1] ? Number(m[1].replace(',', '.')) / 100 : null
  if (margem != null && !(margem >= 0 && margem <= 3)) return null
  return { margem }
}

export type ItemFornecedor = {
  tipo: 'modulo' | 'inversor' | 'bateria' | 'estrutura' | 'outro'
  descricao: string; fabricante?: string | null; qtde: number; unidade?: string | null
  potenciaW?: number | null; potenciaKw?: number | null
}
export type OrcamentoFornecedor = { itens: ItemFornecedor[]; total: number | null; hibrido: boolean; fornecedor?: string | null }

const PROMPT = `Você lê o PDF de um ORÇAMENTO DE FORNECEDOR de energia solar (kit fotovoltaico, on-grid ou híbrido com baterias).
Extraia TODOS os itens do kit e o VALOR TOTAL do orçamento (o total final a pagar, com frete se houver).
Para cada item: tipo ("modulo" = painel/módulo solar, "inversor" = inversor (on-grid, híbrido ou micro), "bateria",
"estrutura" = suportes/perfis/ganchos/grampos/trilhos, "outro" = cabos, conectores, string box, DPS, disjuntores etc.),
descricao (como está no PDF), fabricante (se houver), qtde (número), unidade ("PC", "M"...),
potenciaW (só módulo: watts de UM painel), potenciaKw (só inversor: kW de UM inversor).
hibrido = true se houver bateria ou inversor híbrido/off-grid.
Leia TODAS as páginas e TODAS as linhas da tabela de produtos (não pule nenhuma), copiando a descrição EXATAMENTE como
está escrita. Unidades como "JG" (jogo) valem como estão.
NUNCA invente itens nem valores. Responda SOMENTE com JSON:
{"fornecedor": string|null, "total": number|null, "hibrido": boolean, "itens": [{"tipo": "...", "descricao": "...", "fabricante": string|null, "qtde": number, "unidade": string|null, "potenciaW": number|null, "potenciaKw": number|null}]}`

const cachePaginas = new WeakMap<Buffer, string[]>()
/** Páginas do PDF em PNG (base64), no máximo 6, em escala 2. Falhou → [] (usa o PDF direto). */
async function paginasEmImagem(pdf: Buffer): Promise<string[]> {
  const pronto = cachePaginas.get(pdf)
  if (pronto) return pronto
  const out: string[] = []
  try {
    const { pdf: abrir } = await import('pdf-to-img')
    const doc = await abrir(pdf, { scale: 2 })
    for await (const pagina of doc) { out.push(Buffer.from(pagina).toString('base64')); if (out.length >= 6) break }
  } catch (e) {
    console.error('[pdf fornecedor] não converti em imagem:', e instanceof Error ? e.message : e)
  }
  cachePaginas.set(pdf, out)
  return out
}

async function modeloDocumentos(padrao: string): Promise<string> {
  try {
    const { prisma } = await import('@/lib/prisma')
    const c = await prisma.systemConfig.findUnique({ where: { key: 'ai_model_documentos' } })
    return c?.value?.trim() || padrao
  } catch { return padrao }
}

/** Lê o PDF com a IA (Anthropic lê PDF nativamente). Lança Error com mensagem para o operador. */
export async function lerPdfFornecedor(pdf: Buffer): Promise<OrcamentoFornecedor> {
  const cfg = await loadAiConfig()
  const b64 = pdf.toString('base64')
  let raw = ''
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cfg.model, max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) throw new Error(`A IA não conseguiu ler o PDF (HTTP ${res.status}).`)
    raw = (await res.json())?.content?.[0]?.text ?? ''
  } else if (cfg.provider === 'openai') {
    // OpenAI lê PDF pelo bloco "file" (modelos com visão: gpt-4o / gpt-4o-mini / mais novos)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
      body: JSON.stringify({
        // modelo FORTE só aqui: o gpt-4o-mini errou itens de PDF escaneado (teste 24/11/2026). Troca sem deploy:
        // SystemConfig `ai_model_documentos`.
        model: await modeloDocumentos('gpt-4.1'), max_tokens: 4096, response_format: { type: 'json_object' },
        // PDF escaneado chega como imagem de baixa resolução pelo bloco "file" → a IA inventou itens (teste 24/11).
        // Mandamos cada página como imagem em ALTA resolução (detail high); sem conversor → bloco "file".
        messages: [{ role: 'user', content: [
          ...(await paginasEmImagem(pdf)).map((png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png}`, detail: 'high' } })),
          ...((await paginasEmImagem(pdf)).length ? [] : [{ type: 'file', file: { filename: 'orcamento-fornecedor.pdf', file_data: `data:application/pdf;base64,${b64}` } }]),
          { type: 'text', text: PROMPT },
        ] }],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) throw new Error(`A IA não conseguiu ler o PDF (HTTP ${res.status}).`)
    raw = (await res.json())?.choices?.[0]?.message?.content ?? ''
  } else throw new Error('Nenhuma IA configurada para ler o PDF (Configurações → IA).')
  const j = extractJson<Partial<OrcamentoFornecedor> & { itens?: Partial<ItemFornecedor>[] }>(raw)
  if (!j || !Array.isArray(j.itens)) throw new Error('Não consegui entender o PDF do fornecedor (formato inesperado).')
  const tipos = ['modulo', 'inversor', 'bateria', 'estrutura', 'outro']
  const itens = j.itens
    .map((i) => ({
      tipo: (tipos.includes(String(i.tipo)) ? i.tipo : 'outro') as ItemFornecedor['tipo'],
      descricao: String(i.descricao ?? '').trim(), fabricante: i.fabricante ? String(i.fabricante) : null,
      qtde: Number(i.qtde) || 0, unidade: i.unidade ? String(i.unidade) : null,
      potenciaW: Number(i.potenciaW) || null, potenciaKw: Number(i.potenciaKw) || null,
    }))
    .filter((i) => i.descricao && i.qtde > 0)
  return { itens, total: Number(j.total) > 0 ? Number(j.total) : null, hibrido: !!j.hibrido || itens.some((i) => i.tipo === 'bateria'), fornecedor: j.fornecedor ?? null }
}

const peca = (i: ItemFornecedor): Peca => ({ codigo: '', descricao: i.descricao, qtde: i.qtde, preco: null, fabricante: i.fabricante ?? undefined, unidade: i.unidade ?? undefined } as Peca)

/** Margem a usar: a do comando; senão híbrido 50%, on-grid 60%. */
export const margemDe = (o: OrcamentoFornecedor, doComando: number | null) => doComando ?? (o.hibrido ? MARGEM_HIBRIDO : MARGEM_ONGRID)

/** Monta o "resultado" no formato do PDF KeroSolar. Valor ao cliente = total do fornecedor × (1 + margem). */
export function resultadoDoFornecedor(o: OrcamentoFornecedor, margem: number, telhado: string | null): ResultadoCotacao {
  if (!(o.total && o.total > 0)) throw new Error('Não achei o VALOR TOTAL no PDF do fornecedor. Nada foi gerado.')
  const mod = o.itens.find((i) => i.tipo === 'modulo')
  if (!mod || !(Number(mod.potenciaW) > 0)) throw new Error('Não achei os painéis (com a potência em W) no PDF do fornecedor. Nada foi gerado.')
  const inv = o.itens.find((i) => i.tipo === 'inversor')
  const potenciaKit = Math.round(mod.qtde * Number(mod.potenciaW)) / 1000
  const valorCliente = Math.round(o.total * (1 + margem) * 100) / 100
  const outros = o.itens.filter((i) => i !== mod && i !== inv)
  return {
    potenciaPedidaKwp: potenciaKit,
    modulo: { ...peca(mod), potenciaW: Number(mod.potenciaW), potenciaKitKwp: potenciaKit },
    inversor: { ...(inv ? peca(inv) : peca({ tipo: 'inversor', descricao: 'INVERSOR', qtde: 0 })), potenciaKw: Number(inv?.potenciaKw) || 0, ligacao: '', tensao: '' },
    estrutura: outros.filter((i) => i.tipo === 'estrutura').map(peca),
    componentesCC: outros.filter((i) => i.tipo === 'bateria' || i.tipo === 'outro').map(peca),
    componentesCA: [],
    strings: 0, avisos: [], ajustes: [], totalProdutos: o.total,
    valorCliente,
    cotacaoSalva: null,
    layoutEstrutura: { telhado: telhado ?? 'colonial', grupo: '', subGrupo: '', linhas: 1, modulosPorLinha: mod.qtde, orientacao: 'Retrato' },
  }
}
