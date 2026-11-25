import 'server-only'
// 🤖 Cliente HTTP da Belenus = peça @lib/conector-belenus (Biblioteca) + o que é do CRM: credenciais e filial vindas do
// ambiente (Railway), tempo limite e novas tentativas. Toda chamada passa pela trava de rotas da peça (`rotaPermitida`):
// só consultas do catálogo + a etapa 6 "Confirmação" (Confirmar, ValorSeguro, BuscarFretes) + Salvar. Finalizar pedido,
// mexer no carrinho, pagamento, seguro, frete, cupom, upload — BLOQUEADO antes de sair daqui.
//
// Segurança: e-mail/senha vêm só de BELENUS_EMAIL / BELENUS_SENHA (lidas AQUI, passadas à peça); o token fica só em
// memória durante a cotação; nada disso é logado. O log ([belenus]) mostra só a "forma" das respostas.

import {
  ErroBelenus, chamarBelenus as chamarBelenusLib, clienteBelenus as clienteBelenusLib, loginBelenus as loginBelenusLib,
  type DependenciasBelenus, type OpcoesChamada, type SessaoBelenus,
} from '@lib/conector-belenus'

import { fetchPelaPonte, ponteDisponivel } from './ponte'

export { ErroBelenus, type SessaoBelenus }

/** Dono (24/11/2026): a Belenus está lenta (cotações reais caíram por tempo em "inversores" e "módulos") → 45 s. */
export const TEMPO_LIMITE_MS = 45_000

/**
 * Dono (24/11/2026): a Belenus bloqueia (HTTP 403) qualquer IP de data center — Railway, ServerSP, Contabo. Só aceita
 * internet residencial/empresa. Solução: proxy residencial/ISP brasileiro contratado. Se BELENUS_PROXY_URL estiver no
 * Railway (formato http://usuario:senha@host:porta), SÓ as chamadas à Belenus saem por ele; o resto do CRM não muda.
 */
function fetchPeloProxy(): typeof fetch | undefined {
  const url = process.env.BELENUS_PROXY_URL?.trim()
  if (!url) return undefined
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProxyAgent, fetch: fetchUndici } = require('undici') as typeof import('undici')
  const agente = new ProxyAgent(url)
  return ((entrada: string | URL, init?: RequestInit) =>
    fetchUndici(String(entrada), { ...(init as object), dispatcher: agente } as Parameters<typeof fetchUndici>[1])) as unknown as typeof fetch
}

/** Configuração do conector no CRM: 45 s e 1 nova tentativa SÓ nas consultas do catálogo (nunca Confirmar/Salvar). */
export const DEPS_BELENUS: DependenciasBelenus = {
  tempoLimiteMs: TEMPO_LIMITE_MS,
  novasTentativasConsulta: 1,
  dicaAcessoNegado: 'Confira BELENUS_EMAIL/BELENUS_SENHA no Railway.',
  // Ordem: proxy contratado (se houver) → ponte pelo navegador do CRM aberto. BELENUS_DIRETO=1 = sai direto
  // (scripts rodados no computador do dono com `railway run`, que já está numa internet aceita).
  // Decidido a cada chamada: CRM aberto no navegador → ponte; senão direto (no computador do dono com `railway run`
  // funciona; no servidor a Belenus devolve 403 e o motor cai no banco de referência / fórmula).
  fetch: fetchPeloProxy() ?? (((url: string | URL | Request, init?: RequestInit) =>
    (process.env.BELENUS_DIRETO !== '1' && ponteDisponivel() ? fetchPelaPonte : globalThis.fetch)(url, init)) as typeof fetch),
}

/** Dá para cotar agora? (proxy configurado, saída direta, ou algum CRM aberto no navegador) */
export const belenusAlcancavel = (): boolean =>
  !!process.env.BELENUS_PROXY_URL?.trim() || process.env.BELENUS_DIRETO === '1' || ponteDisponivel()

export function credenciaisBelenus(): { email: string; senha: string } {
  const email = process.env.BELENUS_EMAIL?.trim()
  const senha = process.env.BELENUS_SENHA
  if (!email || !senha) throw new ErroBelenus('Cadastre BELENUS_EMAIL e BELENUS_SENHA no Railway para usar a cotação automática da Belenus.')
  return { email, senha }
}

/** Filial da conta (Belenus-SP = "0001", ver getSiteId/BELENUS_SITE_SELECTED no bundle). */
export const siteBelenus = () => process.env.BELENUS_SITE?.trim() || '0001'

/** Única porta de saída para a Belenus (trava de rotas, tempo limite e envelope de erro na peça). */
export function chamarBelenus(rota: string, corpo: unknown, opts: OpcoesChamada): Promise<unknown> {
  return chamarBelenusLib(rota, corpo, opts, DEPS_BELENUS)
}

/** Login por e-mail com as credenciais do ambiente (erro claro e nenhuma chamada se faltarem). */
export async function loginBelenus(): Promise<SessaoBelenus> {
  return loginBelenusLib(credenciaisBelenus(), DEPS_BELENUS)
}

/** Cliente da sessão: um método por etapa do Gerador Personalizado. */
export const clienteBelenus = (sessao: SessaoBelenus) => clienteBelenusLib(sessao, DEPS_BELENUS)
