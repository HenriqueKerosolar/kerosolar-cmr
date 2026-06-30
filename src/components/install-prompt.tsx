'use client'

import { useEffect, useState } from 'react'

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Detectar se já está instalado
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    // Capturar evento beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowPrompt(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShowPrompt(false)
    }
  }

  if (isInstalled || !showPrompt) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 bg-orange-500 text-white p-4 rounded-lg shadow-lg flex items-center justify-between z-50">
      <div>
        <p className="font-bold">📱 Instalar KeroSolar CRM?</p>
        <p className="text-sm opacity-90">Abra como app no seu computador</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setShowPrompt(false)} className="px-3 py-1 text-sm bg-orange-600 hover:bg-orange-700 rounded">
          Depois
        </button>
        <button onClick={handleInstall} className="px-3 py-1 text-sm bg-white text-orange-600 font-bold rounded hover:bg-orange-50">
          Instalar
        </button>
      </div>
    </div>
  )
}
