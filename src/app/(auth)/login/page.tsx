'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Erro ao entrar'); setLoading(false); return }
    router.push('/leads')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[--background]">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-2xl border border-[--border] bg-[--card]">
        <div className="text-center">
          <div className="text-4xl mb-2">☀️</div>
          <h1 className="text-2xl font-bold">KeroSolar CRM</h1>
          <p className="text-sm text-[--muted-foreground] mt-1">Entre na sua conta</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">E-mail</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none focus:ring-2 focus:ring-[--ring]"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-[--destructive]">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] font-medium text-sm transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
