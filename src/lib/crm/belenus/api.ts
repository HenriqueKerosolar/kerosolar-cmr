import 'server-only'
// 🤖 Cliente HTTP da Belenus (mesma API interna que o site belenus.com.br usa no "Gerador Personalizado").
// Fase 1 = SÓ LEITURA: toda chamada passa por `rotaPermitida` (regras.ts). Qualquer rota fora da lista de
// consulta — carrinho, pedido, pagamento, seguro, frete, cupom, upload — é BLOQUEADA antes de sair daqui.
//
// Segurança: e-mail/senha vêm só de BELENUS_EMAIL / BELENUS_SENHA; o token fica só em memória durante a
// cotação; nada disso é logado. O log ([belenus]) mostra só a "forma" das respostas (formaResposta).
//
// Fonte dos payloads: bundle público main-es2015.e19d38cdd5586599b218.js (serviço "monteSeuKitService").

import { BELENUS_BASE, ROTA_LOGIN, ehObj, formaResposta, mensagensBelenus, rotaPermitida } from './regras'

export const TEMPO_LIMITE_MS = 20_000

export class ErroBelenus extends Error {}

export function credenciaisBelenus(): { email: string; senha: string } {
  const email = process.env.BELENUS_EMAIL?.trim()
  const senha = process.env.BELENUS_SENHA
  if (!email || !senha) throw new ErroBelenus('Cadastre BELENUS_EMAIL e BELENUS_SENHA no Railway para usar a cotação automática da Belenus.')
  return { email, senha }
}

/** Filial da conta (Belenus-SP = "0001", ver getSiteId/BELENUS_SITE_SELECTED no bundle). */
export const siteBelenus = () => process.env.BELENUS_SITE?.trim() || '0001'

export type SessaoBelenus = { token: string }

/** Única porta de saída para a Belenus: valida a rota, aplica tempo limite e trata o envelope de erro. */
export async function chamarBelenus(
  rota: string, corpo: unknown, opts: { token?: string; etapa: string; metodo?: 'GET' | 'POST'; logarForma?: boolean },
): Promise<unknown> {
  const url = BELENUS_BASE + rota.replace(/^\/+/, '')
  if (!rotaPermitida(url)) {
    // nunca deveria acontecer: é a trava que garante que o robô não compra nem gera pedido
    console.error(`[belenus] rota BLOQUEADA (fora da lista de consulta): ${rota.split('?')[0]}`)
    throw new ErroBelenus('Rota da Belenus bloqueada pelo robô (só consultas são permitidas). Nada foi feito.')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-plataforma': '1' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.metodo ?? 'POST', headers, signal: ctrl.signal,
      body: (opts.metodo ?? 'POST') === 'POST' ? JSON.stringify(corpo ?? {}) : undefined,
    })
  } catch (e) {
    const abortou = (e as { name?: string })?.name === 'AbortError'
    throw new ErroBelenus(abortou
      ? `A Belenus não respondeu em ${TEMPO_LIMITE_MS / 1000} s (etapa: ${opts.etapa}). Tente de novo em instantes.`
      : `Não consegui falar com a Belenus (etapa: ${opts.etapa}).`)
  } finally {
    clearTimeout(timer)
  }
  let json: unknown = null
  const texto = await res.text().catch(() => '')
  try { json = texto ? JSON.parse(texto) : null } catch { json = null }
  if (opts.logarForma !== false) {
    console.log(`[belenus] ${opts.etapa}: HTTP ${res.status} forma=${JSON.stringify(formaResposta(json))}`)
  }
  if (res.status === 401 || res.status === 403) throw new ErroBelenus(`A Belenus recusou o acesso (HTTP ${res.status}, etapa: ${opts.etapa}). Confira BELENUS_EMAIL/BELENUS_SENHA no Railway.`)
  const msgs = mensagensBelenus(json)
  if (!res.ok) throw new ErroBelenus(`A Belenus respondeu com erro (HTTP ${res.status}, etapa: ${opts.etapa})${msgs ? `: ${msgs}` : ''}.`)
  if (ehObj(json) && json.isSucceed === false) throw new ErroBelenus(`A Belenus não aceitou (etapa: ${opts.etapa})${msgs ? `: ${msgs}` : ''}.`)
  return json
}

/**
 * Login por e-mail (função `loginEmail` do bundle): POST Usuario/Login/PessoaJuridicaByEmail com
 * { email, senha } (formulário loginEmailForm). O site grava a resposta inteira como sessão e usa `token`.
 */
export async function loginBelenus(): Promise<SessaoBelenus> {
  const { email, senha } = credenciaisBelenus()
  const r = await chamarBelenus(ROTA_LOGIN, { email, senha }, { etapa: 'login', logarForma: false })
  // log só os NOMES dos campos (a resposta tem token e dados da empresa)
  const dados = ehObj(r) && ehObj(r.data) ? r.data : r
  console.log(`[belenus] login: campos=${JSON.stringify(ehObj(r) ? Object.keys(r) : typeof r)}${dados !== r && ehObj(dados) ? ` data=${JSON.stringify(Object.keys(dados))}` : ''}`)
  const token = [r, dados].map((o) => (ehObj(o) ? (o.token ?? o.accessToken ?? o.access_token) : undefined)).find((t) => typeof t === 'string' && t.length > 10)
  if (typeof token !== 'string') throw new ErroBelenus('Login na Belenus não devolveu o token (formato inesperado). Veja o log [belenus] login.')
  return { token }
}
