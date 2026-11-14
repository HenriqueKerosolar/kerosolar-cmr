import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { ResponderComentario } from './responder-comentario'

export const dynamic = 'force-dynamic'

const CHANNEL_ICON: Record<string, string> = { facebook: '💬', instagram: '📷' }
const KIND_LABEL: Record<string, string> = { comment: 'Comentário' }

// Hora no horário de Brasília (DD/MM HH:mm)
function horaBrasilia(d: Date): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
  } catch { return '' }
}

export default async function SocialPage() {
  await verifySession()

  const items = await prisma.socialEngagement.findMany({
    where: { kind: 'comment' }, orderBy: { occurredAt: 'desc' }, take: 100,
    include: { replies: { orderBy: { createdAt: 'asc' }, select: { id: true, text: true, status: true, error: true, createdAt: true } } },
  })

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Comentários</h1>
        <p className="text-sm text-[--muted-foreground]">
          Comentários em posts do Facebook/Instagram. O Mind Marketing responde automaticamente; quando precisar, você
          também pode responder por aqui (a resposta é publicada no comentário, em nome da página). Mensagens diretas
          chegam no{' '}<a href="/inbox" className="underline">Inbox</a>.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="border-2 border-dashed border-[--border] rounded-xl p-8 text-center text-sm text-[--muted-foreground]">
          Nada chegou ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="p-3 rounded-xl border border-[--border] bg-[--card]">
              <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
                <span>{CHANNEL_ICON[it.channel] ?? '📣'}</span>
                <span className="font-medium">{KIND_LABEL[it.kind] ?? it.kind}</span>
                {it.authorName && <span>· {it.authorName}</span>}
                <span className="ml-auto whitespace-nowrap">{horaBrasilia(it.occurredAt)}</span>
              </div>
              <p className="text-sm mt-1">{it.text}</p>
              {it.postPermalink && (
                <a href={it.postPermalink} target="_blank" rel="noreferrer" className="text-xs text-[--primary] hover:underline">
                  Ver post
                </a>
              )}
              <ResponderComentario engagementId={it.id} respostas={it.replies.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
