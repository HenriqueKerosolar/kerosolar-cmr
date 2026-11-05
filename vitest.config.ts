import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Fora do bundler do Next, o pacote real lança ao ser importado ("só em Server Component").
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
  },
})
