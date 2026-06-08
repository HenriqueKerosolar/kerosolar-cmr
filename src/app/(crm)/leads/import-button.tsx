'use client'

import { useState, useRef } from 'react'
import { importLeads, type ImportRow } from '@/app/actions/import'

type Stage = { id: string; name: string }

type Props = { pipelineId: string; stages: Stage[] }

/** Colunas do Kommo mapeadas para os campos internos */
const KOMMO_MAP: Record<string, keyof ImportRow> = {
  // PT
  'nome': 'name', 'name': 'name', 'contato': 'name', 'contact name': 'name',
  'telefone': 'phone', 'phone': 'phone', 'celular': 'phone', 'whatsapp': 'phone', 'mobile': 'phone',
  'email': 'email', 'e-mail': 'email',
  'valor': 'value', 'value': 'value', 'budget': 'value',
  'notas': 'notes', 'notes': 'notes', 'observações': 'notes', 'observacoes': 'notes', 'note': 'notes',
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  for (const line of lines) {
    const cols: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { inQ = !inQ }
      else if ((c === ',' || c === ';') && !inQ) { cols.push(cur.trim()); cur = '' }
      else cur += c
    }
    cols.push(cur.trim())
    rows.push(cols)
  }
  return rows
}

function mapRows(rows: string[][]): ImportRow[] {
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.toLowerCase().trim().replace(/['"]/g, ''))
  const colIndex = (field: keyof ImportRow) => headers.findIndex((h) => KOMMO_MAP[h] === field)
  const idx = {
    name:  colIndex('name'),
    phone: colIndex('phone'),
    email: colIndex('email'),
    value: colIndex('value'),
    notes: colIndex('notes'),
  }
  return rows.slice(1).map((r) => ({
    name:  idx.name  >= 0 ? r[idx.name]  ?? '' : '',
    phone: idx.phone >= 0 ? r[idx.phone] ?? '' : '',
    email: idx.email >= 0 ? r[idx.email] ?? '' : '',
    value: idx.value >= 0 ? r[idx.value] ?? '' : '',
    notes: idx.notes >= 0 ? r[idx.notes] ?? '' : '',
  }))
}

export function ImportButton({ pipelineId, stages }: Props) {
  const [open, setOpen]           = useState(false)
  const [step, setStep]           = useState<'upload' | 'preview' | 'done'>('upload')
  const [rows, setRows]           = useState<ImportRow[]>([])
  const [stageId, setStageId]     = useState(stages[0]?.id ?? '')
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [fileName, setFileName]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      const mapped = mapRows(parsed)
      setRows(mapped)
      setStep('preview')
    }
    reader.readAsText(f, 'utf-8')
    e.target.value = ''
  }

  async function doImport() {
    setLoading(true)
    try {
      const res = await importLeads(rows, stageId, pipelineId)
      setResult(res)
      setStep('done')
    } finally { setLoading(false) }
  }

  function reset() { setStep('upload'); setRows([]); setResult(null); setFileName('') }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="px-3 py-1.5 text-sm rounded-lg border border-[--border] hover:bg-[--accent] transition flex items-center gap-1.5">
      📥 Importar CSV
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[--card] border border-[--border] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[--border]">
          <div>
            <h2 className="font-bold text-lg">📥 Importar leads via CSV</h2>
            <p className="text-sm text-[--muted-foreground]">Kommo, Pipedrive, planilha Excel — qualquer CSV</p>
          </div>
          <button onClick={() => { setOpen(false); reset() }} className="text-2xl text-[--muted-foreground] hover:text-[--foreground] leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* STEP: upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 text-sm text-blue-700 dark:text-blue-300">
                <p className="font-medium mb-1">📌 Colunas reconhecidas automaticamente:</p>
                <p>Nome / Telefone / E-mail / Valor / Notas</p>
                <p className="mt-1 text-xs opacity-80">Funciona com exportações do Kommo, Pipedrive, RD Station e planilhas próprias.</p>
              </div>

              <button onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-[--border] rounded-xl p-10 text-center hover:border-[--primary] hover:bg-[--accent]/30 transition group">
                <p className="text-4xl mb-2">📂</p>
                <p className="font-medium group-hover:text-[--primary]">Clique para selecionar o arquivo CSV</p>
                <p className="text-sm text-[--muted-foreground] mt-1">Formatos aceitos: .csv (separado por vírgula ou ponto-e-vírgula)</p>
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </div>
          )}

          {/* STEP: preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600 font-medium">✅ {fileName}</span>
                <span className="text-[--muted-foreground]">— {rows.length} registros encontrados</span>
                <button onClick={reset} className="ml-auto text-[--muted-foreground] hover:text-[--foreground] underline text-xs">Trocar arquivo</button>
              </div>

              {/* Escolha de etapa */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Importar para a etapa:</label>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[--input] bg-[--background] text-sm font-medium">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Preview da tabela */}
              <div>
                <p className="text-sm font-medium mb-1.5">Prévia (primeiros 5 registros):</p>
                <div className="overflow-x-auto rounded-xl border border-[--border]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[--muted]/50">
                        {['Nome', 'Telefone', 'E-mail', 'Valor', 'Notas'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-[--muted-foreground]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-[--border]">
                          <td className="px-3 py-2 truncate max-w-[120px]">{r.name || <span className="text-[--muted-foreground]">—</span>}</td>
                          <td className="px-3 py-2">{r.phone || <span className="text-[--muted-foreground]">—</span>}</td>
                          <td className="px-3 py-2 truncate max-w-[140px]">{r.email || <span className="text-[--muted-foreground]">—</span>}</td>
                          <td className="px-3 py-2">{r.value || <span className="text-[--muted-foreground]">—</span>}</td>
                          <td className="px-3 py-2 truncate max-w-[120px]">{r.notes || <span className="text-[--muted-foreground]">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 5 && <p className="text-xs text-[--muted-foreground] mt-1">… e mais {rows.length - 5} registros</p>}
              </div>
            </div>
          )}

          {/* STEP: done */}
          {step === 'done' && result && (
            <div className="space-y-4 text-center py-4">
              <p className="text-5xl">{result.imported > 0 ? '🎉' : '⚠️'}</p>
              <div className="space-y-1">
                <p className="text-xl font-bold">{result.imported} leads importados</p>
                {result.skipped > 0 && <p className="text-sm text-[--muted-foreground]">{result.skipped} pulados (sem nome/telefone ou já existentes)</p>}
              </div>
              {result.errors.length > 0 && (
                <div className="text-left p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 text-xs text-red-700 space-y-1">
                  <p className="font-medium">Erros:</p>
                  {result.errors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[--border] flex gap-3 justify-end">
          {step === 'done' ? (
            <>
              <button onClick={() => { setOpen(false); reset() }} className="px-4 py-2 rounded-lg border border-[--border] text-sm hover:bg-[--accent]">Fechar</button>
              <button onClick={reset} className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium">Importar mais</button>
            </>
          ) : step === 'preview' ? (
            <>
              <button onClick={reset} className="px-4 py-2 rounded-lg border border-[--border] text-sm hover:bg-[--accent]">Voltar</button>
              <button onClick={doImport} disabled={loading || rows.length === 0}
                className="px-4 py-2 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-50">
                {loading ? 'Importando…' : `Importar ${rows.length} leads`}
              </button>
            </>
          ) : (
            <button onClick={() => { setOpen(false); reset() }} className="px-4 py-2 rounded-lg border border-[--border] text-sm hover:bg-[--accent]">Cancelar</button>
          )}
        </div>
      </div>
    </div>
  )
}
