// Símbolo do canal nas telas. Regra do dono (15/11/2026): lead que VEIO do Instagram ou do Facebook mantém o
// símbolo de origem mesmo depois de passar para o WhatsApp — para saber sempre o que está convertendo.
// (Sem 'server-only': usado em componentes de cliente.)

export const CANAL_ICONE: Record<string, string> = { whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪', webchat: '🌐' }
const NOME: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', simulator: 'Simulador', webchat: 'Site' }

/**
 * Ícone + legenda da conversa. Se o lead veio do Instagram/Facebook e a conversa é de outro canal (ex.: o
 * cliente aceitou o convite e foi para o WhatsApp), mostra os dois: "📷→🟢".
 */
export function iconeCanal(channel: string | null | undefined, origem?: string | null): { icone: string; titulo: string } {
  const ch = channel ?? ''
  const atual = CANAL_ICONE[ch] ?? '📱'
  if (origem && (origem === 'instagram' || origem === 'facebook') && origem !== ch) {
    return { icone: `${CANAL_ICONE[origem]}→${atual}`, titulo: `Veio do ${NOME[origem]} e agora conversa pelo ${NOME[ch] ?? ch}` }
  }
  return { icone: atual, titulo: NOME[ch] ?? ch }
}
