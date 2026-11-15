// Jornada do lead para o Mind Marketing (campo `journey` de lead.qualified / lead.won / lead.lost).
// Pedido do dono (15/11/2026): "Fechou" é a meta de captura — o Marketing precisa saber o caminho de quem
// fechou (de onde veio, quanto tempo levou, por quais etapas passou, se foi do Direct para o WhatsApp, quem
// atendeu) para entender o que converte. Montado só com o que o CRM já guarda: notas de troca de etapa,
// mensagens (com autor) e o convite Direct→WhatsApp. Esta parte é PURA (testável); a leitura do banco fica
// em leadOutcome.ts.

export interface DadosJornada {
  notas: { content: string; createdAt: Date }[]                 // em ordem cronológica
  mensagens: { direction: string; senderType: string; content: string; createdAt: Date }[] // idem
  etapaAtual: string | null
  leadCriadoEm: Date
  qualificadoEm: string | null                                   // customFields.qualificadoEm
  convite: { channel?: string; usadoEm?: string; leadId?: string } | null
  leadId: string
}

export interface Jornada {
  entryStage: string | null
  firstContactAt: string | null
  budgetSentAt: string | null
  qualifiedAt: string | null
  closedAt: string | null
  daysToClose: number | null
  stagePath: string[]
  channelSwitch: { from: string; to: string; at: string } | null
  messages: { fromClient: number; fromAi: number; fromHuman: number }
  attendedBy: 'ai' | 'ai_and_human' | 'human' | null
}

/** Nome da etapa citado numa nota de troca de etapa ("Movido para "X".", "IA moveu para "X"", "... movido para Repescagem."). */
export function etapaDaNota(texto: string): string | null {
  const aspas = /para "([^"]+)"/.exec(texto)
  if (aspas) return aspas[1].trim()
  const solta = /movido para (Repescagem)\b/i.exec(texto)
  return solta ? solta[1] : null
}

export function montarJornada(d: DadosJornada, fechadoEm: Date | null): Jornada {
  const entrada = d.notas.map((n) => /entrou em "([^"]+)"/.exec(n.content)?.[1]?.trim()).find(Boolean) ?? null

  const caminho: string[] = []
  const add = (nome: string | null | undefined) => {
    const n = nome?.trim()
    if (n && caminho[caminho.length - 1] !== n) caminho.push(n)
  }
  add(entrada)
  for (const n of d.notas) if (!/entrou em "/.test(n.content)) add(etapaDaNota(n.content))
  add(d.etapaAtual)

  const doCliente = d.mensagens.filter((m) => m.direction === 'inbound')
  const daIa = d.mensagens.filter((m) => m.direction === 'outbound' && m.senderType === 'ai').length
  const humano = d.mensagens.filter((m) => m.direction === 'outbound' && m.senderType === 'human').length
  const primeiro = doCliente[0]?.createdAt ?? null
  const orcamento = d.mensagens.find((m) => m.direction === 'outbound' && /OR[ÇC]AMENTO SOLAR|Sistema completo/i.test(m.content))?.createdAt ?? null

  const inicio = primeiro ?? d.leadCriadoEm
  const dias = fechadoEm ? Math.round(((fechadoEm.getTime() - inicio.getTime()) / 86_400_000) * 10) / 10 : null

  const c = d.convite
  const troca = c?.usadoEm && c.leadId === d.leadId && (c.channel === 'instagram' || c.channel === 'facebook')
    ? { from: c.channel, to: 'whatsapp', at: c.usadoEm }
    : null

  return {
    entryStage: entrada,
    firstContactAt: primeiro?.toISOString() ?? null,
    budgetSentAt: orcamento?.toISOString() ?? null,
    qualifiedAt: d.qualificadoEm ?? null,
    closedAt: fechadoEm?.toISOString() ?? null,
    daysToClose: dias,
    stagePath: caminho.slice(-30),
    channelSwitch: troca,
    messages: { fromClient: doCliente.length, fromAi: daIa, fromHuman: humano },
    attendedBy: daIa && humano ? 'ai_and_human' : humano ? 'human' : daIa ? 'ai' : null,
  }
}
