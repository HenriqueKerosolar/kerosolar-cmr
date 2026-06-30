import { verifySession } from '@/lib/dal'

export const dynamic = 'force-dynamic'

/** App de atendimento (mobile, estilo WhatsApp). Protegido por login. */
export default async function AtendimentoLayout({ children }: { children: React.ReactNode }) {
  await verifySession()
  return <div className="h-[100dvh] overflow-hidden bg-zinc-100 text-zinc-900 flex flex-col">{children}</div>
}
