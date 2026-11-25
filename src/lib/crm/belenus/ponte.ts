import 'server-only'
// 🌉 Ponte pelo navegador (dono, 24/11/2026): a Belenus bloqueia (HTTP 403) todo IP de servidor/data center, mas aceita
// internet residencial — e a API dela libera chamadas de qualquer site (CORS `Access-Control-Allow-Origin: *`).
// Então, enquanto o CRM estiver ABERTO num navegador de administrador (computador ou celular), o servidor entrega cada
// chamada à Belenus para esse navegador executar e devolver a resposta. O robô (trava de rotas, regras, preço) continua
// todo no servidor; o navegador só "carrega a carta". Ninguém aberto → falha na hora (o motor usa o banco de orçamentos
// ou a fórmula). Fila em memória: o CRM roda numa instância só no Railway.

import { BELENUS_BASE, rotaPermitida } from '@lib/conector-belenus'

type Pedido = { id: string; url: string; metodo: string; cabecalhos: Record<string, string>; corpo?: string }
type Resposta = { status: number; tipo?: string; texto: string }
type Pendente = Pedido & { resolver: (r: Resposta) => void; rejeitar: (e: Error) => void; entregue: boolean }

type Estado = { fila: Pendente[]; esperando: Array<(p: Pedido | null) => void>; vistos: Map<string, number>; seq: number }
const g = globalThis as unknown as { __ponteBelenus?: Estado }
const estado: Estado = (g.__ponteBelenus ??= { fila: [], esperando: [], vistos: new Map(), seq: 0 })

/** Um navegador conta como "aberto" se pediu trabalho nos últimos 40 s. */
const VIVO_MS = 40_000
export function navegadoresAbertos(agora = Date.now()): number {
  for (const [k, t] of estado.vistos) if (agora - t > VIVO_MS) estado.vistos.delete(k)
  return estado.vistos.size
}
export const ponteDisponivel = () => navegadoresAbertos() > 0

/** fetch que sai pelo navegador. Mesma assinatura usada pela peça @lib/conector-belenus. */
export const fetchPelaPonte: typeof fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  if (!url.startsWith(BELENUS_BASE) || !rotaPermitida(url)) throw new Error('ponte: rota fora da lista')
  if (!ponteDisponivel()) throw new Error('ponte: nenhum CRM aberto no navegador')
  const cabecalhos: Record<string, string> = {}
  new Headers(init?.headers).forEach((v, k) => { cabecalhos[k] = v })
  return new Promise<Response>((resolve, reject) => {
    const p: Pendente = {
      id: `${Date.now()}-${++estado.seq}`, url, metodo: init?.method ?? 'GET', cabecalhos,
      corpo: typeof init?.body === 'string' ? init.body : undefined, entregue: false,
      resolver: (r) => resolve(new Response(r.texto, { status: r.status, headers: { 'content-type': r.tipo || 'application/json' } })),
      rejeitar: reject,
    }
    const tirar = () => { const i = estado.fila.indexOf(p); if (i >= 0) estado.fila.splice(i, 1) }
    init?.signal?.addEventListener('abort', () => { tirar(); const e = new Error('abortado'); e.name = 'AbortError'; reject(e) })
    // Se ninguém pegar em 15 s (navegador fechou agora), falha como "sem conexão".
    setTimeout(() => { if (!p.entregue) { tirar(); reject(new Error('ponte: navegador não pegou o pedido')) } }, 15_000)
    const quem = estado.esperando.shift()
    if (quem) { p.entregue = true; estado.fila.push(p); quem(semFuncoes(p)) } else estado.fila.push(p)
  })
}) as typeof fetch

const semFuncoes = (p: Pendente): Pedido => ({ id: p.id, url: p.url, metodo: p.metodo, cabecalhos: p.cabecalhos, corpo: p.corpo })

/** Navegador pede trabalho (espera até `esperaMs`). Devolve um pedido ou null. */
export function pegarPedido(navegador: string, esperaMs = 20_000): Promise<Pedido | null> {
  estado.vistos.set(navegador, Date.now())
  const livre = estado.fila.find((p) => !p.entregue)
  if (livre) { livre.entregue = true; return Promise.resolve(semFuncoes(livre)) }
  return new Promise((resolve) => {
    const cb = (p: Pedido | null) => { clearTimeout(t); resolve(p) }
    const t = setTimeout(() => {
      const i = estado.esperando.indexOf(cb); if (i >= 0) estado.esperando.splice(i, 1)
      estado.vistos.set(navegador, Date.now())
      resolve(null)
    }, esperaMs)
    estado.esperando.push(cb)
  })
}

/** Navegador devolve a resposta (ou o erro de rede) de um pedido. */
export function devolverResposta(id: string, r: Resposta | { erro: string }): boolean {
  const i = estado.fila.findIndex((p) => p.id === id)
  if (i < 0) return false
  const [p] = estado.fila.splice(i, 1)
  if ('erro' in r) p.rejeitar(new Error(`ponte: ${r.erro}`))
  else p.resolver({ status: Number(r.status) || 0, tipo: r.tipo, texto: String(r.texto ?? '') })
  return true
}
