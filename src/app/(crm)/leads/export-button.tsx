'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteLeadsByStage } from '@/app/actions/lead'

type Stage = { id: string; name: string }

export function ExportButton({ stages }: { stages: Stage[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [baixou, setBaixou] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [result, setResult] = useState('')

  const stageName = stages.find((s) => s.id === stageId)?.name ?? ''

  async function apagar() {
    if (!stageId || apagando) return
    if (!confirm(`Apagar TODOS os leads da etapa "${stageName}"?\n\nIsto remove os leads, conversas e mensagens dessa etapa (os contatos são mantidos). Não dá pra desfazer.\n\nVocê já baixou o CSV?`)) return
    setApagando(true); setResult('')
    try {
      const n = await deleteLeadsByStage(stageId)
      setResult(`✓ ${n} lead(s) apagado(s) da etapa "${stageName}".`)
      setBaixou(false)
      router.refresh()
    } catch {
      setResult('Erro ao apagar.')
    } finally {
      setApagando(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-sm border border-[--border] hover:bg-[--accent]">
        ⬇️ Exportar / Limpar
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-[--card] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[--border]">
              <h2 className="font-bold text-lg">⬇️ Exportar / Limpar etapa</h2>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg hover:bg-[--accent] text-[--muted-foreground] text-lg leading-none">×</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Etapa</label>
                <select value={stageId} onChange={(e) => { setStageId(e.target.value); setBaixou(false); setResult('') }}
                  className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* 1) Baixar */}
              <a href={`/api/crm/export?stageId=${stageId}`} onClick={() => setBaixou(true)}
                className="block text-center px-4 py-2.5 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium">
                ⬇️ Baixar CSV dos contatos
              </a>
              <p className="text-[11px] text-[--muted-foreground]">Abre uma planilha (Excel/Google) com nome, telefone, e-mail, cidade, valor, consumo e datas.</p>

              {/* 2) Limpar (danger zone) */}
              <div className="border-t border-[--border] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">⚠️ Zona de risco</p>
                <p className="text-xs text-[--muted-foreground] mb-2">Depois de salvar o CSV, você pode apagar os leads desta etapa pra limpar o banco. Os <b>contatos são mantidos</b>; leads, conversas e mensagens são removidos. <b>Não dá pra desfazer.</b></p>
                <button onClick={apagar} disabled={apagando}
                  className="w-full px-4 py-2.5 rounded-lg border border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 text-sm font-medium disabled:opacity-50">
                  {apagando ? 'Apagando…' : `🗑️ Apagar os leads da etapa "${stageName}"`}
                </button>
                {!baixou && <p className="text-[11px] text-[--muted-foreground] mt-1">💡 Recomendado baixar o CSV antes de apagar.</p>}
              </div>

              {result && <p className={`text-sm ${result.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{result}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
