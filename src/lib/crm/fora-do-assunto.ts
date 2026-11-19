// 🔇 Mensagens fora do assunto (memes, vídeos de rede social, correntes) — regras do dono (18/11/2026):
// "manda o aviso; depois de dois avisos, bloqueia". 1ª vez → aviso; 2ª → último aviso; 3ª → número na
// Block list (Listas → "não receber"): o que ele mandar depois é ignorado.
// A contagem é a mesma para o aviso da IA (agent.ts, "MENSAGEM FORA DE CONTEXTO") e para o detector de
// links de vídeo abaixo — os dois avisos contêm AVISO_FORA.

export const AVISO_FORA = 'exclusivamente para atendimento de energia solar'

const VIDEO_SOCIAL = /https?:\/\/(?:[\w-]+\.)*(?:instagram\.com\/(?:reels?|p|tv)\/|tiktok\.com\/|vt\.tiktok\.com\/|kwai[\w-]*\.com\/|kw\.ai\/|youtube\.com\/(?:watch|shorts)|youtu\.be\/|facebook\.com\/(?:watch|reel|share\/[rv])|fb\.watch\/)\S*/gi

/** A mensagem é (só) link de vídeo de rede social — no máximo um comentário curto junto? */
export function ehSoLinkDeVideo(texto: string): boolean {
  const t = (texto || '').trim()
  const links = t.match(VIDEO_SOCIAL)
  if (!links?.length) return false
  const resto = t.replace(VIDEO_SOCIAL, '').replace(/\s+/g, ' ').trim()
  return resto.length <= 60
}

export function textoAvisoFora(saudacao: string, numeroDoAviso: 1 | 2): string {
  const base = `${saudacao}! 😊 Obrigada pela mensagem! Só precisamos avisar: este canal é voltado ${AVISO_FORA}. Sou uma inteligência artificial e estou configurada para atender apenas assuntos relacionados ao solar. Por isso, peço com carinho que não envie mensagens desse tipo por aqui. Se precisar de um orçamento de energia solar, é só chamar! 👋`
  return numeroDoAviso === 2
    ? `${base}\n\n⚠️ Este é o segundo aviso: se continuarem chegando mensagens desse tipo, este número será bloqueado.`
    : base
}
