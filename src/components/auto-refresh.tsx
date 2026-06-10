'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Atualiza os dados da página automaticamente (refresh "suave" do App Router — re-busca os
 * server components sem recarregar a página, preservando rolagem e estado dos formulários).
 * Pausa quando a aba está em segundo plano ou quando o usuário está digitando num campo,
 * pra não atrapalhar nem gastar à toa.
 */
export function AutoRefresh({ seconds = 12 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return // aba em 2º plano
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      // não atualiza enquanto o usuário digita (evita atrapalhar)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      router.refresh()
    }, Math.max(5, seconds) * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
