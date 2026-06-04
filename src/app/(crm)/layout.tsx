import { verifySession } from '@/lib/dal'
import { Sidebar } from '@/components/layout/sidebar'

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()
  return (
    <div className="flex h-screen overflow-hidden bg-[--background]">
      <Sidebar name={session.name} role={session.role} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
