import 'server-only'
// 📄 Fase 3 do robô Belenus: o "cota belenus" gera o PDF do orçamento KeroSolar e o deixa SÓ para o operador
// (nota interna com link). O PDF só vai ao cliente quando o operador escreve "envia orçamento" (regra do dono:
// nada vai ao cliente automaticamente).

import { prisma } from '@/lib/prisma'
import { gerarPdfOrcamento } from './orcamento-pdf'
import { lerComandoEnviaOrcamento, montarDadosOrcamento, validarOrcamentoSalvo, type OrcamentoSalvo } from './orcamento'
import { ehObj, num, type ResultadoCotacao } from './regras'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const nomeArquivoOrcamento = (numero: string) => `Orcamento-KeroSolar-${numero}.pdf`

/** Gera o PDF do kit cotado e guarda no lead (customFields.orcamentoBelenus). Não envia nada ao cliente. */
export async function gerarOrcamentoDoLead(leadId: string, r: ResultadoCotacao, agora = new Date(), cfDaRodada?: Record<string, unknown>): Promise<OrcamentoSalvo> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true, contact: { select: { name: true, phone: true, whatsappId: true, email: true, customFields: true } } } })
  // orçamento automático: o motor passa os customFields desta rodada (consumo/cidade lidos agora ainda não estão no banco)
  const cf = cfDaRodada ?? (lead?.customFields as Record<string, unknown> | null) ?? {}
  const solar = ehObj(cf.solar) ? cf.solar : {}
  let consumo = num(cf.consumoKwh ?? solar.consumoKwh)
  if (!(consumo > 0)) {
    const conta = num(cf.billValue ?? solar.contaReais)
    if (conta > 0) consumo = (await import('../solar-calc')).reaisParaKwh(conta)
  }
  const { lerDadosCliente, lerDestino, linhaEndereco } = await import('./regras')
  const cli = lerDadosCliente(lead?.contact, cf)
  const destino = lerDestino(cli.cidade, cli.uf)
  const { carregarTabelaFinanciamento } = await import('../solar-calc')
  await carregarTabelaFinanciamento()
  const dados = montarDadosOrcamento(r, {
    id: leadId, nome: cli.nome, telefone: cli.telefone,
    cidadeUf: destino ? `${destino.cidade} - ${destino.uf}` : null, consumoKwh: consumo > 0 ? consumo : null,
    email: cli.email, endereco: linhaEndereco(cli.endereco), cep: cli.cep,
  }, agora)
  const pdf = await gerarPdfOrcamento(dados)
  const { salvarMidiaRecebida } = await import('../media')
  const arquivo = salvarMidiaRecebida(pdf, '.pdf')
  if (!arquivo) throw new Error('Não consegui guardar o PDF do orçamento.')
  const salvo: OrcamentoSalvo = {
    arquivo, valorCliente: dados.valorTotal, kwp: dados.kwp, criadoEm: agora.toISOString(), numero: dados.numero,
    numeroWeb: r.cotacaoSalva?.numeroWeb ?? null,
  }
  // relê os campos (o cota pode ter mudado algo) e grava só a chave do orçamento
  const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cfAtual = (atual?.customFields as Record<string, unknown> | null) ?? {}
  await prisma.lead.update({ where: { id: leadId }, data: { customFields: { ...cfAtual, orcamentoBelenus: salvo } as object } })
  return salvo
}

/** Texto acrescentado à nota interna do "cota belenus" (link só abre com login no CRM). */
export function textoNotaPdf(o: OrcamentoSalvo): string {
  return `\n\n📄 PDF do orçamento ${o.numero} (${brl(o.valorCliente)}) — só para o operador, NÃO foi enviado ao cliente:\n${o.arquivo}\n` +
    'Para enviar ao cliente, escreva: envia orçamento'
}

export type RetornoEnvia = { tratado: false } | { tratado: true; texto: string }

/**
 * "envia orçamento" (mensagem inteira): manda o último PDF gerado pelo "cota belenus" ao cliente, como DOCUMENTO,
 * pelo canal da conversa. Erro (sem orçamento, vencido, falha de envio) → lança Error com a mensagem para a tela.
 */
export async function comandoEnviaOrcamento(leadId: string, text: string, userId?: string | null, agora = new Date()): Promise<RetornoEnvia> {
  if (!lerComandoEnviaOrcamento(text)) return { tratado: false }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  const v = validarOrcamentoSalvo(cf.orcamentoBelenus, agora)
  if ('erro' in v) throw new Error(v.erro)
  const o = v.ok
  const { lerMidiaSalva } = await import('../media')
  const buffer = lerMidiaSalva(o.arquivo)
  if (!buffer) throw new Error(`O arquivo do orçamento ${o.numero} não está mais no servidor: gere de novo com "cota belenus". Nada foi enviado ao cliente.`)
  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' }, include: { contact: true } })
  if (!conv) throw new Error('Esse lead ainda não tem conversa. Nada foi enviado ao cliente.')
  const { enviarArquivoNaConversa } = await import('../enviar-arquivo')
  const r = await enviarArquivoNaConversa({
    leadId, conv, userId, buffer, nome: nomeArquivoOrcamento(o.numero), mime: 'application/pdf',
    caption: 'Segue o seu orçamento da KeroSolar ☀️', copiaLocal: o.arquivo,
  })
  if (!r.ok) throw new Error(`Não consegui enviar o orçamento: ${r.erro}`)
  await prisma.lead.update({ where: { id: leadId }, data: { value: o.valorCliente } }).catch(() => {})
  const texto = `Orçamento ${o.numero} enviado ao cliente (${brl(o.valorCliente)}).`
  await prisma.note.create({ data: { leadId, type: 'system', content: texto } }).catch(() => {})
  return { tratado: true, texto }
}
