/**
 * 🔁 Regra do dono (2026-11-12): NUNCA repetir resposta numa conversa — nem igual, nem "quase igual"
 * (a IA reescreve a mesma recepção com outras palavras). Compara pelo conjunto de palavras.
 */
const nrm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function palavras(s: string): Set<string> {
  return new Set(nrm(s).split(' ').filter((w) => w.length >= 3))
}

/** Semelhança 0..1 entre dois textos (Jaccard das palavras com 3+ letras). */
export function semelhanca(a: string, b: string): number {
  const A = palavras(a), B = palavras(b)
  if (!A.size || !B.size) return nrm(a) === nrm(b) ? 1 : 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

/** O texto repete (igual ou muito parecido) alguma das mensagens anteriores? */
export function repeteAlguma(texto: string, anteriores: string[], limite = 0.6): boolean {
  const t = nrm(texto)
  if (t.length < 12) return anteriores.some((x) => nrm(x) === t)   // textos curtos: só igual exato
  return anteriores.some((x) => semelhanca(texto, x) >= limite)
}

/** Mesmo texto do cliente (normalizado)? */
export function mesmoTexto(a: string, b: string): boolean {
  return nrm(a) === nrm(b) && nrm(a).length > 0
}
