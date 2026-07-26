'use client'

import { useEffect } from 'react'

/** Abre o WhatsApp automaticamente após um instante (deixa o botão como fallback). */
export function WppRedirect({ url }: { url: string }) {
  useEffect(() => {
    const t = setTimeout(() => { window.location.href = url }, 1200)
    return () => clearTimeout(t)
  }, [url])
  return null
}
