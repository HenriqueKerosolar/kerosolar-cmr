'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createManualLead } from '@/app/actions/lead'

type Stage = { id: string; name: string }

export function NewLeadButton({ pipelineId, stages }: { pipelineId: string; stages: Stage[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [value, setValue] = useState('')
  const [startBot, setStartBot] = useState(true)

  function salvar() {
    if (!name.trim() && !phone.trim()) return
    startTransition(async () => {
      await createManualLead({
        name, phone, email,
        pipelineId, stageId,
        value: value ? parseFloat(value) : 0,
        startBot,
      })
      setOpen(false); setName(''); setPhone(''); setEmail(''); setValue('')
      router.refresh()
    })
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-sm bg-[--primary] text-[--primary-foreground] font-medium">
        + Novo lead
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-[--card] rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg">Novo lead</h2>

            <div>
              <label className="block text-xs font-medium mb-1">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente"
                className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Telefone / WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="21 99999-9999"
                className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">E-mail (opcional)</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com"
                className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Etapa</label>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)}
                  className="w-full px-2 py-2 rounded-lg border border-[--input] bg-[--background] text-sm">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Valor (R$)</label>
                <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0"
                  className="w-full px-2 py-2 rounded-lg border border-[--input] bg-[--background] text-sm outline-none" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[--muted-foreground]">
              <input type="checkbox" checked={startBot} onChange={(e) => setStartBot(e.target.checked)} />
              Acionar o bot da etapa agora (manda a 1ª mensagem se houver WhatsApp conectado)
            </label>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-[--muted-foreground]">Cancelar</button>
              <button onClick={salvar} disabled={pending || (!name.trim() && !phone.trim())}
                className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
                {pending ? 'Salvando…' : 'Criar lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
