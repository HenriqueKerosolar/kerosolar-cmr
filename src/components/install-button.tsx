'use client'

import { useEffect, useState } from 'react'

type BIPEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> }

/** Botão "Instalar" do app (usa o prompt nativo do Chrome/Android). Some quando já instalado. */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [instalado, setInstalado] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(display-mode: standalone)').matches) { setInstalado(true); return }
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent) }
    const onInstalled = () => { setInstalado(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (instalado || !deferred) return null

  return (
    <button
      onClick={async () => { deferred.prompt(); try { await deferred.userChoice } catch {} ; setDeferred(null) }}
      className="text-xs px-3 py-1.5 rounded-lg bg-white text-orange-600 font-semibold whitespace-nowrap shadow-sm">
      📲 Instalar
    </button>
  )
}
