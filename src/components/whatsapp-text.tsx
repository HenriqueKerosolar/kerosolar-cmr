'use client'

import { Fragment } from 'react'

/**
 * Renderiza texto no estilo do WhatsApp:
 * - preserva quebras de linha (\n)
 * - *negrito*  → <strong>
 * - _itálico_  → <em>
 */
export function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g)
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (/^\*[^*\n]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>
        if (/^_[^_\n]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
        return <Fragment key={i}>{p}</Fragment>
      })}
    </span>
  )
}
