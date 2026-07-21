import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { PushSetup } from '@/components/push-setup'
import { InboxList } from './inbox-list'

export const dynamic = 'force-dynamic'

function inicioDeHojeBR(): Date {
  const agora = new Date()
  const br = new Date(agora.getTime() - 3 * 3600000)
  br.setUTCHours(0, 0, 0, 0)
  return new Date(br.getTime() + 3 * 3600000)
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ todas?: string; novos?: string }> }) {
  await verifySession()
  const { todas, novos } = await searchParams
  const verTodas = todas === '1'
  const verNovos = novos === '1'

  // Só conversas com INTERAÇÃO REAL do cliente (pelo menos 1 mensagem recebida).
  // Leads que só receberam mensagens do sistema/IA NÃO aparecem no Inbox.
  const all = await prisma.conversation.findMany({
    where: { messages: { some: { direction: 'inbound' } } },
    orderBy: { lastMessageAt: 'asc' }, // mais antigos primeiro (fila: quem espera há mais tempo no topo)
    take: 200,
    include: {
      contact: true,
      lead: { include: { stage: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  const hoje = inicioDeHojeBR()
  const ehNovoHoje = (conv: (typeof all)[number]) =>
    !!conv.lead && new Date(conv.lead.createdAt).getTime() >= hoje.getTime()

  const needsHuman = (conv: (typeof all)[number]) =>
    !conv.resolvedAt && (
      conv.lead?.humanOnly === true ||
      conv.lead?.aiEnabled === false ||
      (conv.messages[0]?.direction === 'inbound' && !conv.messages[0]?.isRead)
    )

  // "Novos hoje" (vindo do painel): mostra todas as conversas com interação, com os leads
  // criados hoje FIXADOS no topo. Caso contrário aplica o filtro normal.
  const base = (verTodas || verNovos) ? all.filter((c) => !c.resolvedAt) : all.filter(needsHuman)
  const conversations = base
    .sort((a, b) => {
      if (verNovos) {
        const na = ehNovoHoje(a) ? 1 : 0, nb = ehNovoHoje(b) ? 1 : 0
        if (na !== nb) return nb - na // novos de hoje primeiro
      }
      // depois: prioridade máxima no topo, mantendo a ordem mais-antigo→mais-novo
      return Number(b.lead?.highPriority ?? false) - Number(a.lead?.highPriority ?? false)
    })
    .map((conv) => ({
      id: conv.id,
      channel: conv.channel,
      leadId: conv.leadId,
      resolvedAt: conv.resolvedAt?.toISOString() ?? null,
      contact: conv.contact ? { name: conv.contact.name, phone: conv.contact.phone } : null,
      lead: conv.lead ? {
        highPriority: conv.lead.highPriority,
        aiEnabled: conv.lead.aiEnabled,
        humanOnly: conv.lead.humanOnly,
        createdAt: conv.lead.createdAt.toISOString(),
        stage: { name: conv.lead.stage.name, color: conv.lead.stage.color },
      } : null,
      messages: conv.messages.map((m) => ({
        direction: m.direction,
        isRead: m.isRead,
        content: m.content,
        senderType: m.senderType,
      })),
    }))

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold">Inbox</h1>
        <div className="flex items-center gap-1 text-sm">
          <PushSetup />
          <Link href="/inbox" className={`px-3 py-1 rounded-lg ${!verTodas && !verNovos ? 'bg-[--primary] text-[--primary-foreground]' : 'border border-[--border]'}`}>Precisam de mim</Link>
          <Link href="/inbox?todas=1" className={`px-3 py-1 rounded-lg ${verTodas ? 'bg-[--primary] text-[--primary-foreground]' : 'border border-[--border]'}`}>Todas</Link>
        </div>
      </div>
      <p className="text-sm text-[--muted-foreground]">
        {verNovos ? `${conversations.length} conversa(s) — novos de hoje no topo`
          : verTodas ? `${conversations.length} conversas`
          : `${conversations.length} conversa(s) precisam de atendimento humano`}
      </p>
      <InboxList conversations={conversations} verTodas={verTodas} />
    </div>
  )
}
