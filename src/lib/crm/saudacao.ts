/**
 * 🕒 Cumprimento ÚNICO do sistema, pelo horário de Brasília (regra do dono, 2026-11-09):
 *   05h–11h59 Bom dia · 12h–17h59 Boa tarde · 18h–23h59 Boa noite · 00h–04h59 Boa madrugada
 * Use SEMPRE esta função — nunca calcule o cumprimento em outro lugar.
 */
export type Saudacao = 'Bom dia' | 'Boa tarde' | 'Boa noite' | 'Boa madrugada'

export function horaBrasilia(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(d)) % 24
}

export function saudacaoAgora(d: Date = new Date()): Saudacao {
  const h = horaBrasilia(d)
  if (h >= 5 && h < 12) return 'Bom dia'
  if (h >= 12 && h < 18) return 'Boa tarde'
  if (h >= 18) return 'Boa noite'
  return 'Boa madrugada'
}

const RE_CUMPRIMENTO = /^\s*[^\p{L}]{0,4}\s*(bom dia|boa tarde|boa noite|boa madrugada|ol[áa]|oi)(?!\p{L})/iu

/** A mensagem já começa com um cumprimento? (Bom dia/Boa tarde/…/Olá/Oi) */
export function comecaComCumprimento(texto: string): boolean {
  return RE_CUMPRIMENTO.test(texto || '')
}

/** Troca um cumprimento ERRADO no início ("Bom dia!" às 17h) pelo certo do horário. */
export function corrigirCumprimento(texto: string, d: Date = new Date()): string {
  const certo = saudacaoAgora(d)
  return (texto || '').replace(/^(\s*[^\p{L}]{0,4}\s*)(bom dia|boa tarde|boa noite|boa madrugada)(?!\p{L})/iu, (_m, pre: string, achado: string) =>
    achado.toLowerCase() === certo.toLowerCase() ? `${pre}${achado}` : `${pre}${certo}`)
}

/** Garante o cumprimento certo no início: corrige o errado ou acrescenta "Boa tarde! " quando não houver. */
export function comCumprimento(texto: string, d: Date = new Date()): string {
  const t = corrigirCumprimento(texto, d)
  return comecaComCumprimento(t) ? t : `${saudacaoAgora(d)}! ${t.trimStart()}`
}
