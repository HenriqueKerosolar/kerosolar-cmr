import { verifySession } from '@/lib/dal'
import { Sidebar } from '@/components/layout/sidebar'
import { AutoRefresh } from '@/components/auto-refresh'
import { BelenusPonte } from '@/components/belenus-ponte'

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()
  return (
    <div className="flex h-screen overflow-hidden bg-[--background]">
      {/* Atualiza os dados de todas as páginas do CRM a cada 12s (refresh suave) */}
      <AutoRefresh seconds={12} />
      {/* Robô Belenus: este navegador faz as chamadas enquanto o CRM estiver aberto (só admin) */}
      {session.role === 'admin' && <BelenusPonte />}
      <Sidebar name={session.name} role={session.role} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
