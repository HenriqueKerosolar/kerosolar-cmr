import 'server-only'
// ⚡ Fase 5 (dono liberou para os clientes, 24/11/2026): o ORÇAMENTO AUTOMÁTICO do motor da IA usa a Belenus.
//   • kWp pela fórmula (consumo ÷ (HSP 4,5 × 30 × 0,8)), kit e cotação = mesma função do "cota belenus";
//   • sucesso → o texto do orçamento usa o VALOR AO CLIENTE da Belenus e o PDF KeroSolar vai logo DEPOIS do texto;
//   • falha/demora (> ~120 s, fila incluída) → o motor manda o orçamento pela fórmula de sempre e avisa o operador.
// Liga/desliga sem deploy: SystemConfig `belenus_auto` ('0' desliga; padrão LIGADO). Sem BELENUS_EMAIL/SENHA → fórmula.

import { prisma } from '@/lib/prisma'
import { ajustarValorVenda } from '../solar-calc'
import { entradaDoLead, montarKitBelenus } from './cotar'
import { dimensionarConsumoKeroSolar, textoNota, TRANSFORMADOR_PRECO, type ResultadoCotacao } from './regras'
import { belenusAlcancavel } from './api'
import { buscarReferencia, orcamentoDaReferencia } from './banco'
import type { OrcamentoSalvo } from './orcamento'

/** Quando o orçamento automático do motor pode ir pela Belenus (o resto fica na fórmula de sempre). */
export function podeUsarBelenusNoOrcamento(c: {
  permitido: boolean; simulador: boolean; hibrido: boolean; ampliacao: boolean; valorVendaFixo: boolean
  kitMinimo: boolean; variosValores: boolean; soTransformador: boolean
}): boolean {
  return c.permitido && !c.simulador && !c.hibrido && !c.ampliacao && !c.valorVendaFixo && !c.kitMinimo
    && !c.variosValores && !c.soTransformador
}

/** O orçamento da fórmula com o VALOR AO CLIENTE da Belenus (parcelas, payback e economia recalculados). */
export function solarComValorBelenus<T extends Parameters<typeof ajustarValorVenda>[0]>(solar: T, valorCliente: number, comTransformador: boolean) {
  // ajustarValorVenda arredonda para reais; o valor mostrado ao cliente fica o exato da Belenus (igual ao PDF)
  return { ...ajustarValorVenda(solar, valorCliente), valorSistema: Math.round(valorCliente * 100) / 100, transformador: comTransformador ? true : undefined, belenus: true as const }
}

/** Tempo máximo de TODA a cotação automática (espera na fila + Belenus). O cliente não pode ficar sem resposta. */
export const LIMITE_AUTO_MS = 120_000

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Chave `belenus_auto` ('1' ligado, padrão) + credenciais cadastradas. */
export async function belenusAutoLigado(): Promise<{ ligado: boolean; motivo?: string }> {
  if (!process.env.BELENUS_EMAIL?.trim() || !process.env.BELENUS_SENHA) return { ligado: false, motivo: 'BELENUS_EMAIL/BELENUS_SENHA não cadastradas' }
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'belenus_auto' } })
    const v = (cfg?.value ?? '').trim()
    if (v === '0' || /^(off|false|nao|não|desligado)$/i.test(v)) return { ligado: false, motivo: 'chave belenus_auto desligada' }
  } catch { /* sem config → padrão ligado */ }
  return { ligado: true }
}

export type OrcamentoAuto =
  | { ok: true; resultado: ResultadoCotacao; valorCliente: number; orcamento: OrcamentoSalvo | null; nota: string }
  | { ok: false; motivo: string }

function comLimite<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`a Belenus passou de ${Math.round(ms / 1000)} s`)), ms) }),
  ])
}

/**
 * Cota na Belenus para o orçamento automático. NUNCA lança: devolve { ok:false, motivo } para o motor mandar a
 * fórmula. `cf` = customFields JÁ atualizados nesta rodada (medidor/cidade lidos agora ainda não estão no banco).
 */
export async function orcamentoBelenusAuto(p: {
  leadId: string; consumoKwh: number; cf: Record<string, unknown>; limiteMs?: number; agora?: Date
}): Promise<OrcamentoAuto> {
  const limite = p.limiteMs ?? LIMITE_AUTO_MS
  const inicio = Date.now()
  try {
    if (!(p.consumoKwh > 0)) return { ok: false, motivo: 'sem consumo para dimensionar' }
    const dim = dimensionarConsumoKeroSolar(p.consumoKwh)
    const lead = await prisma.lead.findUnique({ where: { id: p.leadId }, select: { contact: { select: { name: true, phone: true, whatsappId: true, email: true, customFields: true } } } })
    const entrada = entradaDoLead(dim.kwp, p.cf, lead?.contact)
    // 1º Belenus ao vivo (pelo CRM aberto no navegador / proxy); fora do alcance ou falhou → banco de referência
    let resultado: ResultadoCotacao | null = null
    let motivoBelenus = ''
    if (belenusAlcancavel()) {
      try {
        resultado = await comLimite(montarKitBelenus(entrada, { esperaMaxMs: limite }), limite)
        if (resultado.valorCliente == null || !(resultado.valorCliente > 0)) {
          motivoBelenus = resultado.avisos.find((a) => /Total não lido/.test(a)) ?? 'a Belenus não devolveu o total'
          resultado = null
        }
      } catch (e) { motivoBelenus = e instanceof Error ? e.message : String(e) }
    } else motivoBelenus = 'nenhum CRM aberto no navegador para falar com a Belenus'
    let doBanco = false
    if (!resultado) {
      const ref = await buscarReferencia(entrada, dim.placas)
      if (!ref) return { ok: false, motivo: `${motivoBelenus}; sem orçamento de referência perto de ${dim.placas} placas no banco` }
      resultado = orcamentoDaReferencia(ref, entrada, TRANSFORMADOR_PRECO)
      doBanco = true
      console.log('[belenus auto] usando banco (%s): %d placas de %s', motivoBelenus, ref.placas, ref.criadoEm)
    }
    const valorCliente = resultado.valorCliente as number
    resultado.avisos.unshift(`Orçamento AUTOMÁTICO (IA): consumo ${Math.round(p.consumoKwh)} kWh → ${dim.kwp.toLocaleString('pt-BR')} kWp pela fórmula (HSP 4,5 × 30 × 80%).${doBanco ? ` Belenus ao vivo: ${motivoBelenus}.` : ''}`)
    // PDF KeroSolar (mesma geração do "cota belenus"); falha no PDF não derruba o orçamento (vai só o texto)
    let orcamento: OrcamentoSalvo | null = null
    let notaPdf = ''
    try {
      const { gerarOrcamentoDoLead } = await import('./orcamento-cmd')
      orcamento = await gerarOrcamentoDoLead(p.leadId, resultado, p.agora ?? new Date(), { ...p.cf, consumoKwh: p.consumoKwh })
      notaPdf = `\n\n📄 PDF do orçamento ${orcamento.numero} enviado ao cliente logo depois do texto:\n${orcamento.arquivo}`
    } catch (e) {
      notaPdf = `\n\n⚠️ PDF do orçamento não gerado (${e instanceof Error ? e.message : 'erro'}): o cliente recebeu só o texto.`
    }
    const nota = `${textoNota(resultado)}\n\n✅ Enviado ao cliente pelo orçamento automático da IA: ${brl(valorCliente)}.${notaPdf}`
    console.log('[belenus auto] ok em %ds: %s', Math.round((Date.now() - inicio) / 1000), brl(valorCliente))
    return { ok: true, resultado, valorCliente, orcamento, nota }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[belenus auto] falhou em %ds: %s', Math.round((Date.now() - inicio) / 1000), motivo)
    return { ok: false, motivo }
  }
}

/** Documento a mandar DEPOIS da resposta de texto (o motor devolve; quem envia é o chamador, como o texto). */
export type DocumentoDepois = { leadId: string; conversationId: string; arquivo: string; nome: string; caption: string }

export function documentoDoOrcamento(leadId: string, conversationId: string, o: OrcamentoSalvo): DocumentoDepois {
  return { leadId, conversationId, arquivo: o.arquivo, nome: `Orcamento-KeroSolar-${o.numero}.pdf`, caption: 'Segue o seu orçamento da KeroSolar ☀️' }
}

/** Envia o PDF pelo canal da conversa (enviar-arquivo.ts) e grava no histórico. Nunca lança. */
export async function enviarDocumentoDepois(d: DocumentoDepois | null | undefined): Promise<void> {
  if (!d) return
  try {
    const { lerMidiaSalva } = await import('../media')
    const buffer = lerMidiaSalva(d.arquivo)
    if (!buffer) throw new Error('arquivo do PDF não encontrado')
    const conv = await prisma.conversation.findUnique({ where: { id: d.conversationId }, include: { contact: true } })
    if (!conv) throw new Error('conversa não encontrada')
    const { enviarArquivoNaConversa } = await import('../enviar-arquivo')
    const r = await enviarArquivoNaConversa({ leadId: d.leadId, conv, buffer, nome: d.nome, mime: 'application/pdf', caption: d.caption, copiaLocal: d.arquivo })
    if (!r.ok) throw new Error(r.erro)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[belenus auto] PDF não enviado:', motivo)
    await prisma.note.create({ data: { leadId: d.leadId, type: 'system', content: `⚠️ O PDF do orçamento não foi enviado ao cliente (${motivo}). Para enviar, escreva: envia orçamento` } }).catch(() => {})
  }
}
