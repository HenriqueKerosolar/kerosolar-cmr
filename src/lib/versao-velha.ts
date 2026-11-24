// Tela aberta ANTES de uma atualização do CRM chama uma Server Action que não existe mais
// ("Failed to find Server Action") e a mensagem não sai — 24/11/2026: o "simula financiamento" do dono
// sumiu assim, sem aviso. Detecta esse erro, guarda o texto digitado e recarrega a página.

export function ehVersaoVelha(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '')
  return /failed to find server action|server action .* not found|UnrecognizedActionError/i.test(msg)
}

const CHAVE = 'kerosolar:rascunho-apos-atualizar'

/** Avisa, guarda o rascunho e recarrega. Use no catch de quem chama Server Action. */
export function recarregarPorVersaoVelha(rascunho?: { onde: string; texto: string }) {
  try { if (rascunho?.texto) sessionStorage.setItem(CHAVE, JSON.stringify(rascunho)) } catch { /* sem storage */ }
  alert('O CRM foi atualizado. A página vai recarregar — sua mensagem NÃO foi enviada; ela volta para o campo, é só enviar de novo.')
  window.location.reload()
}

/** Devolve (e apaga) o rascunho guardado antes do recarregamento, se for desta tela. */
export function pegarRascunho(onde: string): string | null {
  try {
    const raw = sessionStorage.getItem(CHAVE)
    if (!raw) return null
    const r = JSON.parse(raw) as { onde?: string; texto?: string }
    if (r.onde !== onde) return null
    sessionStorage.removeItem(CHAVE)
    return r.texto ?? null
  } catch { return null }
}
