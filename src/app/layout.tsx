import type { Metadata, Viewport } from 'next'
import './globals.css'
import { InstallPrompt } from '@/components/install-prompt'

export const metadata: Metadata = {
  title: 'KeroSolar Atendimento',
  description: 'CRM omnichannel da KeroSolar — WhatsApp, Instagram e Facebook',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'KeroSolarZap', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#f97316',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="KeroSolar CRM" />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{__html: `
          if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.log('SW error:', e))
            })
          }
        `}} />
      </head>
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  )
}
