// Lê um valor em reais digitado pelo atendente ("12.500", "12500,00", "R$ 12.500,50", "12500.5").
// Usado ao mover o lead para "Fechou": o valor REAL da venda (pedido do dono, 16/11/2026).
export function lerValorBRL(texto: string): number | null {
  let t = (texto || '').replace(/[^\d,.]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')            // formato BR: 12.500,50
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')          // 12.500 (milhar)
  const n = Math.round(parseFloat(t) * 100) / 100
  return n > 0 && isFinite(n) ? n : null
}
