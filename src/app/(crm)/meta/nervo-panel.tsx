'use client'

import { useState, useTransition } from 'react'
import { conectarAoMind, verificarNervoAgora, type NervoPainel } from '@/app/actions/nervo'

/**
 * Instagram & Facebook (14/11/2026): decisão do dono — UMA conexão só com a Meta, a do Mind Marketing.
 * As mensagens diretas chegam aqui pelo Nervo e as respostas voltam por ele. Esta tela NÃO salva
 * conexão própria com a Meta; mostra o estado do Nervo e o botão "Conectar ao Mind".
 */
export function NervoPanel({ inicial }: { inicial: NervoPainel }) {
  const [p, setP] = useState(inicial)
  const [ocupado, start] = useTransition()
  const rodar = (fn: () => Promise<NervoPainel>) => start(async () => { try { setP(await fn()) } catch (e) { alert(e instanceof Error ? e.message : 'Erro') } })

  const conectado = p.estado === 'Conectado ao Mind'
  const cor = conectado ? 'bg-green-100 text-green-800 border-green-300'
    : p.codigo ? 'bg-amber-100 text-amber-900 border-amber-300'
    : 'bg-zinc-100 text-zinc-700 border-zinc-300'

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Instagram & Facebook</h1>
        <p className="text-sm text-[--muted-foreground] mt-1">
          As mensagens diretas (Messenger e Instagram Direct) da KeroSolar chegam pelo <b>Mind Marketing</b>, que é a única
          conexão com a Meta. Elas aparecem no Inbox e a IA atende igual ao WhatsApp; as respostas voltam pelo Mind Marketing.
          Não é preciso configurar nada da Meta aqui.
        </p>
      </div>

      <div className="rounded-xl border border-[--border] bg-white dark:bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Conexão com o Mind (Nervo)</h2>
          {p.configurado && <span className={`text-xs px-2.5 py-1 rounded-full border ${cor}`}>{p.estado}</span>}
        </div>

        {!p.configurado ? (
          <div className="text-sm space-y-2">
            <p>O Nervo ainda não está configurado neste CRM. Faltam estas variáveis no Railway:</p>
            <ul className="list-disc pl-5 font-mono text-xs">{p.faltam.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        ) : (
          <>
            {p.codigo && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 p-4 text-center space-y-1">
                <p className="text-sm">Abra o painel do Mind e <b>aceite o pedido</b> com este código:</p>
                <p className="text-3xl font-bold tracking-widest font-mono">{p.codigo}</p>
                {p.expiraEm && <p className="text-xs text-[--muted-foreground]">Vale até {new Date(p.expiraEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} (15 min). Depois de aceitar, clique em “Verificar agora”.</p>}
              </div>
            )}
            {p.mensagem && <p className="text-sm text-[--muted-foreground]">{p.mensagem}</p>}
            {p.alcancavel === false && <p className="text-sm text-red-600">O Mind não respondeu na última tentativa.</p>}
            <div className="flex gap-2 flex-wrap">
              {!conectado && (
                <button disabled={ocupado} onClick={() => rodar(() => conectarAoMind(false))}
                  className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50">
                  {ocupado ? 'Aguarde…' : '🔗 Conectar ao Mind'}
                </button>
              )}
              <button disabled={ocupado} onClick={() => rodar(verificarNervoAgora)}
                className="px-4 py-2 rounded-lg border border-[--border] text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                ↻ Verificar agora
              </button>
              {!conectado && p.podeReconectar && (
                <button disabled={ocupado} onClick={() => { if (confirm('Pedir um novo código? O pedido anterior deixa de valer.')) rodar(() => conectarAoMind(true)) }}
                  className="px-4 py-2 rounded-lg border border-[--border] text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                  Pedir novo código
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
