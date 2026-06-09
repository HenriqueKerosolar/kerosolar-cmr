'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/leads',         icon: '🏆', label: 'Leads' },
  { href: '/inbox',         icon: '💬', label: 'Inbox' },
  { href: '/contatos',      icon: '👥', label: 'Contatos' },
  { href: '/funis',         icon: '📊', label: 'Funis' },
  { href: '/whatsapp',      icon: '📱', label: 'WhatsApp' },
  { href: '/meta',          icon: '📷', label: 'Insta/Face' },
  { href: '/agenda',        icon: '📅', label: 'Agenda' },
  { href: '/simulador',     icon: '🧪', label: 'Simulador' },
  { href: '/aprendizado',   icon: '🧠', label: 'Aprendizado' },
  { href: '/configuracoes', icon: '⚙️', label: 'Config' },
]

export function Sidebar({ name, role }: { name: string; role: string }) {
  const path = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-16 md:w-56 flex flex-col border-r border-[--sidebar-border] bg-[--sidebar] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-[--sidebar-border]">
        <span className="text-2xl">☀️</span>
        <span className="hidden md:block font-bold text-sm leading-tight">KeroSolar<br /><span className="text-[--muted-foreground] font-normal">CRM</span></span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV.map((item) => {
          const active = path.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                active ? 'bg-[--primary] text-[--primary-foreground]' : 'hover:bg-[--accent] text-[--foreground]'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="hidden md:block">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-[--sidebar-border]">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-[--primary] text-[--primary-foreground] flex items-center justify-center text-xs font-bold shrink-0">
            {name?.[0]?.toUpperCase()}
          </div>
          <div className="hidden md:block min-w-0">
            <p className="text-xs font-medium truncate">{name}</p>
            <p className="text-[11px] text-[--muted-foreground] capitalize">{role}</p>
          </div>
        </div>
        <button onClick={logout} className="mt-1 w-full text-left px-3 py-2 text-xs text-[--muted-foreground] hover:text-[--destructive] rounded-lg hover:bg-[--accent] transition">
          <span className="hidden md:inline">Sair</span><span className="md:hidden">↩</span>
        </button>
      </div>
    </aside>
  )
}
