'use client'

import { useEffect, useState } from 'react'

function urlB64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr.buffer
}

/**
 * Registra o app (service worker) e ativa as notificações push.
 * Mostra um botão "Ativar notificações" enquanto não estiverem ligadas.
 */
export function PushSetup() {
  const [status, setStatus] = useState<'idle' | 'on' | 'off' | 'unsupported' | 'loading'>('idle')

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported'); return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      if (Notification.permission === 'granted') { await subscribe(reg); setStatus('on') }
      else if (Notification.permission === 'denied') setStatus('off')
      else setStatus('idle')
    }).catch(() => setStatus('unsupported'))
  }, [])

  async function subscribe(reg: ServiceWorkerRegistration) {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!key) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToArrayBuffer(key) })
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
  }

  async function ativar() {
    setStatus('loading')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setStatus('off'); return }
      const reg = await navigator.serviceWorker.ready
      await subscribe(reg)
      setStatus('on')
    } catch { setStatus('off') }
  }

  if (status === 'unsupported' || status === 'on') return null

  return (
    <button onClick={ativar} disabled={status === 'loading'}
      className="text-xs px-3 py-1.5 rounded-lg bg-white text-orange-600 font-medium disabled:opacity-60 whitespace-nowrap shadow-sm"
      title={status === 'off' ? 'As notificações foram bloqueadas — libere nas configurações do navegador/app' : 'Receber aviso quando chegar mensagem de cliente'}>
      {status === 'loading' ? 'Ativando…' : status === 'off' ? '🔔 Notificações bloqueadas' : '🔔 Ativar notificações'}
    </button>
  )
}
