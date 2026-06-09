import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
  // Baileys e libs nativas rodam no servidor sem serem empacotadas pelo bundler
  // (pdf-parse/pdfjs-dist precisam ficar fora do bundle p/ achar o pdf.worker)
  serverExternalPackages: ['@whiskeysockets/baileys', 'pino', 'qrcode', 'pdf-parse', 'pdfjs-dist'],
}

export default nextConfig
