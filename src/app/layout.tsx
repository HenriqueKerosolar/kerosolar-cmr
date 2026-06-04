import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KeroSolar CRM',
  description: 'CRM omnichannel da KeroSolar — WhatsApp, Instagram e Facebook',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
