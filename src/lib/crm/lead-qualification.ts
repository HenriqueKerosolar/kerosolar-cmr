// Resume, numa linha curta, o que o Sol já qualificou do lead (Lead.customFields: billValue, city...)
// pra aparecer no card do kanban sem precisar abrir o lead. Nenhuma fórmula de pontuação nova — só
// o que já existe. Sem dado nenhum, devolve `null` (nunca um placeholder tipo "sem dados").

export function summarizeQualification(customFields: Record<string, unknown> | null | undefined): string | null {
  if (!customFields || typeof customFields !== 'object') return null

  const billValue = typeof customFields.billValue === 'number' ? customFields.billValue : undefined
  const city = typeof customFields.city === 'string' && customFields.city.trim() ? customFields.city.trim() : undefined

  const parts: string[] = []
  if (billValue) parts.push(`${billValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}/mês`)
  if (city) parts.push(city)

  return parts.length > 0 ? parts.join(' · ') : null
}
