'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { responderComentarioAction } from '@/app/actions/comentarios'

export type RespostaView = { id: string; text: string; status: string; error: string | null; createdAt: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '⏳ enviando…', cls: 'text-amber-700' },
  sent: { label: '✓ respondido', cls: 'text-green-700' },
  failed: { label: '⚠️ não enviado', cls: 'text-red-600' },
}

/** Respostas já dadas pelo CRM + caixa para responder o comentário (14/11/2026). */
export function ResponderComentario({ engagementId, respostas }: { engagementId: string; respostas: RespostaView[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, start] = useTransition()

  const enviar = () => start(async () => {
    setErro('')
    const r = await responderComentarioAction(engagementId, texto)
    if (r.ok) { setTexto(''); setAberto(false); router.refresh() } else setErro(r.erro ?? 'Erro ao enviar')
  })

  return (
    <div className="mt-2 space-y-1.5">
      {respostas.map((r) => (
        <div key={r.id} className="ml-4 pl-3 border-l-2 border-orange-300 text-sm">
          <p className="whitespace-pre-wrap">{r.text}</p>
          <p className={`text-[11px] ${STATUS[r.status]?.cls ?? ''}`}>
            {STATUS[r.status]?.label ?? r.status}
            {r.status === 'failed' && r.error ? ` — ${r.error}` : ''}
          </p>
        </div>
      ))}
      {!aberto ? (
        <button onClick={() => setAberto(true)} className="text-xs text-orange-700 hover:underline">↩︎ Responder</button>
      ) : (
        <div className="space-y-1.5">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} autoFocus
            placeholder="Sua resposta (vai publicada no comentário, em nome da página da KeroSolar)"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white dark:bg-zinc-900 text-sm" />
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <div className="flex gap-2">
            <button disabled={ocupado || !texto.trim()} onClick={enviar}
              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50">
              {ocupado ? 'Enviando…' : 'Publicar resposta'}
            </button>
            <button onClick={() => { setAberto(false); setErro('') }} className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
