'use client'

import { useState } from 'react'

export default function SetProfilePicturePage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function setLogo() {
    setLoading(true)
    try {
      const res = await fetch('/api/whatsapp/set-profile-picture', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setResult('✅ ' + (data.message || 'Logo atualizada com sucesso!'))
      } else {
        setResult('❌ Erro: ' + (data.error || 'Falha desconhecida'))
      }
    } catch (err) {
      setResult('❌ Erro: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Atualizar Logo do WhatsApp</h1>
      <p className="text-gray-600 mb-6">Clique no botão abaixo para colocar a logo da KeroSolar no perfil do WhatsApp.</p>

      <button
        onClick={setLogo}
        disabled={loading}
        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded disabled:opacity-50"
      >
        {loading ? '⏳ Atualizando...' : '🎨 Colocar Logo da KeroSolar'}
      </button>

      {result && (
        <div className="mt-6 p-4 bg-gray-100 rounded text-center font-medium">
          {result}
        </div>
      )}
    </div>
  )
}
