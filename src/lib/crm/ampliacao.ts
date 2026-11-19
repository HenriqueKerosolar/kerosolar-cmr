// ➕ AMPLIAÇÃO de sistema que o cliente JÁ TEM — regra do dono (18/11/2026): não manda orçamento
// automático; pergunta qual kit está instalado (inversor e placas) e pede o orçamento antigo, a nota
// fiscal ou o projeto, se tiver. Depois o atendimento vai para o consultor. Parte pura (testável).

const sem = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function ehAmpliacao(texto: string): boolean {
  const t = sem(texto)
  if (!t.trim()) return false
  // verbo de ampliar + placas/sistema/inversor
  const ampliar = /\b(amplia\w*|ampliar|aumentar|aumento|acrescentar|acrescimo|adicionar|incluir|inclusao|colocar mais|botar mais|por mais|mais \d+ (placas?|paineis|modulos?)|expandir|expansao)\b/
  const objeto = /\b(placas?|paineis|painel|modulos?|sistema|inversor|usina|kit)\b/
  // já tem energia solar instalada
  const jaTem = /\b(ja (tenho|tem|possuo|instalei|instalou|coloquei)|tenho (placas?|paineis|energia solar|sistema solar|usina)|minhas placas|meus paineis|minha usina|meu inversor|meu sistema|meu kit)\b/
  if (ampliar.test(t) && objeto.test(t) && (jaTem.test(t) || /\b(amplia\w*|expandir|expansao)\b/.test(t))) return true
  if (jaTem.test(t) && ampliar.test(t)) return true
  return false
}

export function textoAmpliacao(saudacao: string): string {
  return `${saudacao}! Que bom que você já tem energia solar 😊 Para ampliar o seu sistema, preciso saber o que está instalado hoje:\n\n• *Inversor:* marca e modelo (e a potência)\n• *Placas:* marca, modelo, potência de cada uma e quantas são\n\nSe tiver o *orçamento antigo*, a *nota fiscal* ou o *projeto*, pode me mandar foto ou PDF que ajuda muito! Com isso a gente vê se o seu inversor aguenta mais placas e qual placa trabalha junto com as suas.`
}
