'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/painel',        icon: '🏠', label: 'Painel' },
  { href: '/leads',         icon: '🏆', label: 'Leads' },
  { href: '/inbox',         icon: '💬', label: 'Inbox' },
  { href: '/contatos',      icon: '👥', label: 'Contatos' },
  { href: '/funis',         icon: '📊', label: 'Funis' },
  { href: '/whatsapp',      icon: '📱', label: 'WhatsApp' },
  { href: '/meta',          icon: '📷', label: 'Insta/Face' },
  { href: '/agenda',        icon: '📅', label: 'Agenda' },
  { href: '/simulador',     icon: '🧪', label: 'Simulador' },
  { href: '/aprendizado',   icon: '🧠', label: 'Aprendizado' },
  { href: '/resultados',     icon: '📊', label: 'Resultados' },
  { href: '/whatsapp-cloud', icon: '📡', label: 'API WhatsApp' },
  { href: '/templates',      icon: '📋', label: 'Templates' },
  { href: '/listas',         icon: '🚫', label: 'Listas' },
  { href: '/configuracoes', icon: '⚙️', label: 'Config' },
]

export function Sidebar({ name, role }: { name: string; role: string }) {
  const path = usePathname()
  const router = useRouter()
  const [inboxCount, setInboxCount] = useState(0)

  // Sinalização de novas entradas: badge no menu Inbox, atualizado a cada 10s.
  useEffect(() => {
    let ativo = true
    const carregar = () => fetch('/api/inbox/count').then((r) => r.ok ? r.json() : null).then((d) => { if (ativo && d) setInboxCount(d.count ?? 0) }).catch(() => {})
    carregar()
    const t = setInterval(carregar, 10000)
    return () => { ativo = false; clearInterval(t) }
  }, [])

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
          const badge = item.href === '/inbox' && inboxCount > 0 ? inboxCount : 0
          return (
            <Link key={item.href} href={item.href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                active ? 'bg-[--primary] text-[--primary-foreground]' : 'hover:bg-[--accent] text-[--foreground]'
              }`}
            >
              <span className="text-base relative">
                {item.icon}
                {/* bolinha vermelha no ícone quando a sidebar está recolhida (mobile/estreita) */}
                {badge > 0 && <span className="md:hidden absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />}
              </span>
              <span className="hidden md:block">{item.label}</span>
              {badge > 0 && (
                <span className="hidden md:flex ml-auto min-w-[20px] h-5 items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold px-1.5">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
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
