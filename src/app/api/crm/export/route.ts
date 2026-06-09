import { NextRequest, NextResponse } from 'next/server'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

/** Exporta os leads de uma etapa em CSV (para salvar os contatos antes de limpar o banco). */
export async function GET(req: NextRequest) {
  const session = await getSessionSafe()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const stageId = new URL(req.url).searchParams.get('stageId')
  if (!stageId) return NextResponse.json({ error: 'Etapa não informada.' }, { status: 400 })

  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const leads = await prisma.lead.findMany({
    where: { stageId },
    include: { contact: true },
    orderBy: { createdAt: 'asc' },
  })

  const fmtData = (d: Date | null) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''
  const cel = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`   // escapa aspas
  }

  const cabecalho = ['Nome', 'Telefone', 'Email', 'Cidade', 'Etapa', 'Origem', 'Valor (R$)', 'Consumo (kWh)', 'Criado em', 'Última mensagem']
  const linhas = leads.map((l) => {
    const cf = (l.customFields as Record<string, unknown> | null) ?? {}
    return [
      l.contact?.name ?? l.title,
      l.contact?.phone ?? l.contact?.whatsappId ?? '',
      l.contact?.email ?? '',
      cf.city ?? '',
      stage?.name ?? '',
      l.source ?? '',
      l.value ?? 0,
      cf.consumoKwh ?? '',
      fmtData(l.createdAt),
      fmtData(l.lastMessageAt),
    ].map(cel).join(';')
  })

  // BOM (UTF-8) pro Excel abrir com acento certo; separador ';' (padrão BR)
  const csv = '﻿' + [cabecalho.map(cel).join(';'), ...linhas].join('\r\n')
  const nomeArq = `leads_${(stage?.name ?? 'etapa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeArq}"`,
    },
  })
}
