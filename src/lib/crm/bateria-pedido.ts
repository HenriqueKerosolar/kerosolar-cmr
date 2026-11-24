// 🔋 Pedido de orçamento HÍBRIDO / OFF-GRID / COM BATERIA — regra do dono (24/11/2026, Dora: "Quanto fica a
// bateria solar?" foi para o humano e ele mandou à mão a mensagem abaixo). A IA responde com o MESMO teor:
// pergunta quais aparelhos o cliente quer manter funcionando na falta de energia e pede a conta de luz.
// Parte pura (testável).

const sem = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O cliente está pedindo/perguntando sobre sistema com bateria (híbrido, off-grid, nobreak solar)? */
export function pedeSistemaComBateria(texto: string): boolean {
  const t = sem(texto)
  if (!t.trim()) return false
  return /\bhibrid\w*|\boff[\s-]?grid\b|\bbateria\w*|\bbackup\b|armazenamento de energia|\bnobreak\b|sistema isolado|\bisolado da rede\b|falta de (luz|energia)|acaba a luz|quando (falta|cai) (a )?(luz|energia)/.test(t)
}

export function textoBateria(saudacao: string, nome?: string | null): string {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0]
  const n = primeiro && /^[a-zà-ú]{2,}$/i.test(primeiro) ? `, ${primeiro}` : ''
  return `${saudacao}${n}! 😊 Para montarmos o seu sistema com bateria do jeito certo, precisamos saber *quais aparelhos você pretende manter funcionando na falta de energia* (e, se souber, por quanto tempo).\n\nAlém disso, a sua *conta de luz* (foto ou PDF) nos ajuda a calcular a quantidade ideal de painéis solares para a sua casa.\n\nAguardamos suas informações para darmos continuidade ao seu atendimento!`
}
