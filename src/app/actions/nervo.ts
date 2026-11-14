'use server'

// Pareamento do CRM com o Mind (Nervo) — gatilho PRÓPRIO, sem depender de lead ganho/perdido (14/11/2026).
// O dono clica "Conectar ao Mind", o CRM pede o pareamento e mostra o código XXXX-XXXX; o dono confere o
// mesmo código no painel do Mind e aceita (o pedido vale 15 min). Só administrador.
import { verifyAdmin } from '@/lib/dal'
import { loadNervoConfig } from '@/lib/nervo/config'
import { getCrmNervo } from '@/lib/nervo/fromEnv'

export type NervoPainel = {
  configurado: boolean
  faltam: string[]
  estado?: string
  mensagem?: string
  codigo?: string
  expiraEm?: string
  podeReconectar?: boolean
  alcancavel?: boolean | null
}

const ESTADOS: Record<string, string> = {
  paired: 'Conectado ao Mind',
  pending: 'Aguardando você aceitar no painel do Mind',
  denied: 'Pedido recusado no Mind',
  ended: 'Conexão encerrada',
  expired: 'Pedido expirou sem aceite (vale 15 min)',
  revoked: 'Conexão revogada no Mind',
  seal_error: 'Erro ao abrir a credencial guardada (SESSION_SECRET mudou?)',
  unconfigured: 'Ainda não conectado',
  unreachable: 'Mind fora do ar ou inacessível',
}

async function painel(acao?: (n: NonNullable<ReturnType<typeof getCrmNervo>>) => Promise<unknown>): Promise<NervoPainel> {
  const cfg = loadNervoConfig(process.env, { publicAppUrl: process.env.NEXT_PUBLIC_APP_URL, sealSecret: process.env.SESSION_SECRET })
  if (cfg.status === 'disabled') return { configurado: false, faltam: ['NERVO_BASE_URL', 'MIND_MARKETING_CLIENT_ACCOUNT_ID'] }
  if (cfg.status === 'incomplete') return { configurado: false, faltam: cfg.missing }
  const nervo = getCrmNervo()
  if (!nervo) return { configurado: false, faltam: ['(configuração recusada — veja o log do servidor)'] }
  if (acao) await acao(nervo)
  const s = await nervo.status()
  return {
    configurado: true, faltam: [],
    estado: s ? (ESTADOS[s.state] ?? s.state) : 'Desconhecido',
    mensagem: s?.message,
    codigo: s?.state === 'pending' ? s.userCode : undefined,
    expiraEm: s?.state === 'pending' ? s.expiresAt : undefined,
    podeReconectar: s?.canRestart ?? true,
    alcancavel: s?.reachable ?? null,
  }
}

/** Estado atual (não fala com o Mind). */
export async function statusNervo(): Promise<NervoPainel> {
  await verifyAdmin()
  return painel()
}

/** Pede o pareamento ao Mind (ou confere se o dono já aceitou). `deNovo` = descarta o pedido anterior e pede outro. */
export async function conectarAoMind(deNovo = false): Promise<NervoPainel> {
  await verifyAdmin()
  return painel((n) => n.advance(deNovo))
}

/** Verifica agora: avança o pareamento e envia o que ficou pendente na caixa de saída. */
export async function verificarNervoAgora(): Promise<NervoPainel> {
  await verifyAdmin()
  return painel((n) => n.tick())
}
