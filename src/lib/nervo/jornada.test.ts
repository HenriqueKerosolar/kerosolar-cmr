import { describe, expect, it } from 'vitest'
import { etapaDaNota, montarJornada } from './jornada'

const t = (iso: string) => new Date(iso)

describe('montarJornada — caminho de quem fechou (pedido do dono 15/11/2026)', () => {
  const dados = {
    leadId: 'L1',
    leadCriadoEm: t('2026-11-15T03:40:00Z'),
    etapaAtual: 'Fechou',
    qualificadoEm: '2026-11-20T14:00:00.000Z',
    convite: { channel: 'instagram', usadoEm: '2026-11-15T03:42:52.000Z', leadId: 'L1' },
    notas: [
      { content: 'Lead criado via instagram — entrou em "Chegada Insta/Face".', createdAt: t('2026-11-15T03:40:01Z') },
      { content: 'IA moveu para "Recebeu orçamento automático".', createdAt: t('2026-11-15T03:42:00Z') },
      { content: 'Convite para seguir no WhatsApp enviado (código PYR2J).', createdAt: t('2026-11-15T03:42:10Z') },
      { content: 'Movido para "Financiamento pedido de documentos".', createdAt: t('2026-11-18T10:00:00Z') },
      { content: 'Movido para "Financiamento Aprovado. ".', createdAt: t('2026-11-20T14:00:00Z') },
      { content: 'Movido para "Fechou".', createdAt: t('2026-11-22T18:30:00Z') },
    ],
    mensagens: [
      { direction: 'inbound', senderType: 'contact', content: 'Boa noite', createdAt: t('2026-11-15T03:40:14Z') },
      { direction: 'outbound', senderType: 'ai', content: 'Boa madrugada!', createdAt: t('2026-11-15T03:40:33Z') },
      { direction: 'inbound', senderType: 'contact', content: '650 kWh', createdAt: t('2026-11-15T03:41:37Z') },
      { direction: 'outbound', senderType: 'ai', content: '☀️ *ORÇAMENTO SOLAR · KEROSOLAR*', createdAt: t('2026-11-15T03:42:08Z') },
      { direction: 'outbound', senderType: 'human', content: 'Oi, aqui é o Henrique', createdAt: t('2026-11-16T12:00:00Z') },
    ],
  }

  it('monta entrada, datas, caminho, troca de canal e quem atendeu', () => {
    const j = montarJornada(dados, t('2026-11-22T18:30:00Z'))
    expect(j.entryStage).toBe('Chegada Insta/Face')
    expect(j.firstContactAt).toBe('2026-11-15T03:40:14.000Z')
    expect(j.budgetSentAt).toBe('2026-11-15T03:42:08.000Z')
    expect(j.qualifiedAt).toBe('2026-11-20T14:00:00.000Z')
    expect(j.closedAt).toBe('2026-11-22T18:30:00.000Z')
    expect(j.daysToClose).toBe(7.6)
    expect(j.stagePath).toEqual(['Chegada Insta/Face', 'Recebeu orçamento automático', 'Financiamento pedido de documentos', 'Financiamento Aprovado.', 'Fechou'])
    expect(j.channelSwitch).toEqual({ from: 'instagram', to: 'whatsapp', at: '2026-11-15T03:42:52.000Z' })
    expect(j.messages).toEqual({ fromClient: 2, fromAi: 2, fromHuman: 1 })
    expect(j.attendedBy).toBe('ai_and_human')
  })

  it('no lead.qualified (sem fechamento) closedAt e daysToClose ficam null', () => {
    const j = montarJornada(dados, null)
    expect(j.closedAt).toBeNull()
    expect(j.daysToClose).toBeNull()
  })

  it('lead antigo (nota sem etapa de entrada) e sem convite: o que não se sabe vem null', () => {
    const j = montarJornada({ ...dados, convite: null, notas: [{ content: 'Lead criado via whatsapp.', createdAt: t('2026-11-15T03:40:01Z') }] }, null)
    expect(j.entryStage).toBeNull()
    expect(j.channelSwitch).toBeNull()
    expect(j.stagePath).toEqual(['Fechou'])
  })

  it('lê as notas de troca de etapa nos formatos do CRM', () => {
    expect(etapaDaNota('Movido automaticamente para "Leads adquiridos" por inatividade do cliente.')).toBe('Leads adquiridos')
    expect(etapaDaNota('Conversou na Chegada mas não avançou — movido para Repescagem.')).toBe('Repescagem')
    expect(etapaDaNota('Cliente aceitou o orçamento.')).toBeNull()
  })
})
