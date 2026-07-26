import type { Metadata } from 'next'
import { WppRedirect } from './wpp-redirect'

// Número oficial (WhatsApp Cloud API) — recebe os leads dos anúncios e cai no CRM com a IA.
const NUMERO = '552120276013'
const TEXTO_PADRAO = 'Olá! Vim pelo Google e quero um orçamento de energia solar ☀️'

export const metadata: Metadata = {
  title: 'KeroSolar — Fale no WhatsApp',
  description: 'Orçamento de energia solar rápido e sem compromisso pelo WhatsApp.',
  robots: { index: false, follow: false }, // página de redirect não deve ser indexada
}

export default async function WppPage({ searchParams }: { searchParams: Promise<{ msg?: string; src?: string }> }) {
  const { msg } = await searchParams
  const texto = (msg?.trim() || TEXTO_PADRAO).slice(0, 300)
  const waUrl = `https://wa.me/${NUMERO}?text=${encodeURIComponent(texto)}`

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: 'linear-gradient(160deg,#fff7ed 0%,#ffedd5 100%)' }}>
      <div className="flex items-center gap-2">
        <span className="text-4xl">☀️</span>
        <span className="text-2xl font-bold text-zinc-800">KeroSolar</span>
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold text-zinc-800">Abrindo o WhatsApp…</h1>
        <p className="text-sm text-zinc-600">
          Você vai falar direto com a nossa equipe para um <strong>orçamento de energia solar</strong> — rápido e sem compromisso.
        </p>
      </div>

      <a href={waUrl}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-green-500 hover:bg-green-600 text-white font-semibold text-base shadow-lg transition">
        💬 Falar no WhatsApp
      </a>

      <p className="text-xs text-zinc-400">Se não abrir automaticamente, toque no botão acima.</p>

      <WppRedirect url={waUrl} />
    </main>
  )
}
