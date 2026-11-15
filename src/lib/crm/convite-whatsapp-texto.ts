// Partes puras (sem banco) do convite Instagram/Facebook → WhatsApp. Ver convite-whatsapp.ts.

/** Número oficial do WhatsApp da KeroSolar (o mesmo da página /wpp). */
export const NUMERO_WHATSAPP = '552120276013'

// Sem 0/O, 1/I/L: o cliente não confunde se precisar digitar.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function gerarCodigoConvite(): string {
  let s = ''
  for (let i = 0; i < 5; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return s
}

export function normalizarCodigo(code: string): string {
  return code.trim().toUpperCase()
}

/** Acha o código na mensagem que o link do convite deixa pronta ("... código: K7F2X"). */
export function extrairCodigoConvite(texto: string): string | null {
  const m = /c[oó]d(?:igo)?\.?\s*[:#-]?\s*([A-Za-z0-9]{5})(?![A-Za-z0-9])/i.exec(texto ?? '')
  return m ? m[1] : null
}

export function linkConviteWhatsapp(code: string, channel: string): string {
  const origem = channel === 'facebook' ? 'Facebook' : 'Instagram'
  const msg = `Olá! Vim do ${origem} e quero continuar meu atendimento. Código: ${code}`
  return `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(msg)}`
}

export function textoConvite(link: string): string {
  return `Pra te atender mais rápido e te mandar tudo certinho, quer continuar pelo *WhatsApp*? 😊 É só tocar no link, a mensagem já vai pronta:\n${link}\n\nSe preferir, seguimos por aqui mesmo.`
}

function semAcento(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Sinais de INTERESSE REAL (regra do dono, 15/11/2026): mandou a conta de luz (foto/PDF), pediu orçamento
 * por kWh ou por R$, ou disse que vai conversar com a esposa/marido/família.
 */
export function interesseReal(texto: string, mandouArquivo: boolean): boolean {
  if (mandouArquivo) return true
  const t = semAcento(texto ?? '')
  if (/\d[\d.,]*\s*(kwh|kw\/h|kw h|quilowatt)/.test(t)) return true
  if (/r\$\s*\d|\d[\d.,]*\s*(reais|real)\b/.test(t)) return true
  if (/\b(conversar|falar|ver|consultar|mostrar|decidir|combinar|pensar|resolver)\b.{0,30}\b(esposa|mulher|marido|esposo|familia|socio|socia|patroa)\b/.test(t)) return true
  return false
}
