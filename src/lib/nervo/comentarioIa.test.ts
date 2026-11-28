import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { ignorarComentario, lerDecisao, promptComentario } from './comentarioIa'

describe('IA responde comentários (28/11/2026)', () => {
  it('ignora vazio, só marcação/emoji e a própria página', () => {
    expect(ignorarComentario('@fulano', 'Ana')).toBe(true)
    expect(ignorarComentario('😍😍', 'Ana')).toBe(true)
    expect(ignorarComentario('Quanto custa?', 'KeroSolar')).toBe(true)
    expect(ignorarComentario('Quanto custa um kit solar?', 'Ana')).toBe(false)
  })
  it('lê a decisão e nunca publica valor', () => {
    expect(lerDecisao('{"responder": true, "texto": "Oi Ana! Te espero no direct 😊"}')).toEqual({ responder: true, texto: 'Oi Ana! Te espero no direct 😊' })
    expect(lerDecisao('{"responder": false, "texto": ""}')).toEqual({ responder: false, texto: '' })
    expect(lerDecisao('{"responder": true, "texto": "Fica a partir de R$ 9.000"}')).toEqual({ responder: false, texto: '' })
    expect(lerDecisao('lixo')).toBeNull()
  })
  it('Facebook leva o link do WhatsApp; Instagram chama no direct', () => {
    expect(promptComentario('facebook')).toContain('wa.me/552120276013')
    expect(promptComentario('instagram')).toContain('direct')
  })
})
