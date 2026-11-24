import { describe, it, expect } from 'vitest'
import { pedeSistemaComBateria, textoBateria } from './bateria-pedido'

describe('pedido de sistema com bateria (Dora, 24/11/2026)', () => {
  it('reconhece híbrido, off-grid e bateria', () => {
    for (const t of ['Quanto fica a bateria solar?', 'quero um orçamento híbrido', 'vocês fazem off grid?', 'sistema offgrid', 'preciso de backup quando falta luz'])
      expect(pedeSistemaComBateria(t), t).toBe(true)
  })
  it('não confunde com pedido comum', () => {
    for (const t of ['quero orçamento on grid', 'minha conta é 500', 'Bom dia'])
      expect(pedeSistemaComBateria(t), t).toBe(false)
  })
  it('texto com o teor da mensagem do dono', () => {
    const m = textoBateria('Bom dia', 'Dora Lindgren')
    expect(m.startsWith('Bom dia, Dora!')).toBe(true)
    expect(m).toContain('aparelhos você pretende manter funcionando na falta de energia')
    expect(m).toContain('conta de luz')
    expect(textoBateria('Boa tarde', '.').startsWith('Boa tarde!')).toBe(true)
  })
})
