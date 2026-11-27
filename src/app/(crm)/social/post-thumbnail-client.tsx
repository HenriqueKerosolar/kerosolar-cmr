'use client'

import { useState } from 'react'

/** Miniatura do post (CDN da Meta). A URL expira em alguns dias — some sozinha se falhar ao carregar. */
export function PostThumbnail({ src, href }: { src: string; href?: string | null }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className="w-14 h-14 rounded-lg object-cover shrink-0 border border-[--border]"
    />
  )

  if (!href) return img
  return (
    <a href={href} target="_blank" rel="noreferrer" className="shrink-0">
      {img}
    </a>
  )
}
