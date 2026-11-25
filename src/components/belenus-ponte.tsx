'use client'
// 🌉 Enquanto o CRM estiver aberto (admin), este navegador faz as chamadas do robô à Belenus — ela bloqueia servidores,
// mas aceita a internet de casa/escritório/celular. Só executa pedidos para belenus.com.br vindos do nosso servidor.
import { useEffect } from 'react'

const BASE = 'https://belenus.com.br/'

export function BelenusPonte() {
  useEffect(() => {
    let parar = false
    // Só uma aba por navegador faz o trabalho (as outras ficam quietas).
    const id = Math.random().toString(36).slice(2, 10)
    const ehLider = () => {
      try {
        const v = JSON.parse(localStorage.getItem('belenus-ponte') || 'null') as { id: string; t: number } | null
        if (!v || v.id === id || Date.now() - v.t > 45_000) { localStorage.setItem('belenus-ponte', JSON.stringify({ id, t: Date.now() })); return true }
        return false
      } catch { return true }
    }
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

    async function laco() {
      while (!parar) {
        if (!ehLider()) { await dormir(10_000); continue }
        try {
          const r = await fetch(`/api/belenus/ponte?n=${id}`, { cache: 'no-store' })
          if (r.status === 401) return // não é admin: não participa
          if (!r.ok) { await dormir(5_000); continue }
          const { pedido } = (await r.json()) as { pedido: { id: string; url: string; metodo: string; cabecalhos: Record<string, string>; corpo?: string } | null }
          if (!pedido) continue
          if (!pedido.url.startsWith(BASE)) continue
          let volta: Record<string, unknown>
          try {
            const resp = await fetch(pedido.url, {
              method: pedido.metodo, headers: pedido.cabecalhos, body: pedido.corpo,
              signal: AbortSignal.timeout(45_000), credentials: 'omit', referrerPolicy: 'no-referrer',
            })
            volta = { id: pedido.id, status: resp.status, tipo: resp.headers.get('content-type') ?? '', texto: await resp.text() }
          } catch (e) {
            volta = { id: pedido.id, erro: (e as Error)?.name === 'TimeoutError' ? 'sem resposta' : 'falha de rede' }
          }
          await fetch('/api/belenus/ponte', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(volta) }).catch(() => {})
        } catch {
          await dormir(5_000)
        }
      }
    }
    laco()
    return () => { parar = true }
  }, [])
  return null
}
