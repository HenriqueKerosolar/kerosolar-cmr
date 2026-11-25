import { verifySession } from '@/lib/dal'
import { BelenusPonte } from '@/components/belenus-ponte'

export const dynamic = 'force-dynamic'

/** App de atendimento (mobile, estilo WhatsApp). Protegido por login. */
export default async function AtendimentoLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()
  return (
    <div className="h-[100dvh] overflow-hidden bg-zinc-100 text-zinc-900 flex flex-col">
      {/* Robô Belenus: o celular aberto também faz as cotações (só admin) — antes só o CRM completo fazia */}
      {session.role === 'admin' && <BelenusPonte />}
      {children}
    </div>
  )
}
