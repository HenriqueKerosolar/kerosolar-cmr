import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
  // Baileys e libs nativas rodam no servidor sem serem empacotadas pelo bundler
  serverExternalPackages: ['@whiskeysockets/baileys', 'pino', 'qrcode', 'pdfkit', 'pdf-to-img', 'pdfjs-dist', '@napi-rs/canvas', 'undici'],
}

export default nextConfig
