import 'server-only'
// 📄 "orça esse" (legenda do PDF do fornecedor anexado no CRM) → PDF KeroSolar guardado no lead, só para o operador.
import { prisma } from '@/lib/prisma'
import { lerPdfFornecedor, margemDe, resultadoDoFornecedor } from './pdf-fornecedor'
import { gerarOrcamentoDoLead } from './orcamento-cmd'
import { lerTelhado } from './regras'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Devolve o texto da nota (também mostrado na tela). Lança Error com a mensagem para o operador. */
export async function processarPdfFornecedor(leadId: string, pdf: Buffer, margemDoComando: number | null): Promise<string> {
  const { salvarMidiaRecebida } = await import('../media')
  const copiaFornecedor = salvarMidiaRecebida(pdf, '.pdf')
  const o = await lerPdfFornecedor(pdf)
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  const margem = margemDe(o, margemDoComando)
  const r = resultadoDoFornecedor(o, margem, lerTelhado(cf.telhado ?? cf.tipoTelhado ?? cf.roofType))
  const salvo = await gerarOrcamentoDoLead(leadId, r)
  const pct = Math.round(margem * 1000) / 10
  const texto = [
    `📄 Orçamento a partir do PDF do fornecedor${o.fornecedor ? ` (${o.fornecedor})` : ''}${o.hibrido ? ' — HÍBRIDO' : ''}:`,
    `• Custo do fornecedor: ${brl(o.total ?? 0)} + margem ${pct}% → valor ao cliente ${brl(salvo.valorCliente)}`,
    `• Kit: ${r.modulo.qtde} × ${r.modulo.potenciaW} W = ${salvo.kwp.toLocaleString('pt-BR')} kWp · ${o.itens.length} itens lidos pela IA`,
    `• PDF KeroSolar ${salvo.numero} (NÃO enviado ao cliente — confira os itens): ${salvo.arquivo}`,
    ...(copiaFornecedor ? [`• PDF original do fornecedor (só interno): ${copiaFornecedor}`] : []),
    'Para enviar ao cliente, escreva: envia orçamento',
  ].join('\n')
  await prisma.note.create({ data: { leadId, type: 'system', content: texto } }).catch(() => {})
  return texto
}
