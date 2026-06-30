'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { sendManualMessage, moveLeadStage, encerrarConversa } from '@/app/actions/lead'

type Msg = { id: string; direction: string; senderType: string; content: string; mediaUrl: string | null; mediaType: string | null; createdAt: string }
type Stage = { id: string; name: string; color: string | null }

const canalIcone: Record<string, string> = { whatsapp: '🟢', instagram: '📷', facebook: '💬', simulator: '🧪', webchat: '🌐' }

/** Converte áudio gravado (webm/mp4…) pra MP3 — formato que o WhatsApp aceita como voz. */
async function blobToMp3(blob: Blob): Promise<File> {
  const arrayBuf = await blob.arrayBuffer()
  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)
  if (!AudioCtx) throw new Error('AudioContext não disponível')
  const ctx = new AudioCtx()
  const audioBuf = await ctx.decodeAudioData(arrayBuf)
  ctx.close()

  const len = audioBuf.length
  const rate = audioBuf.sampleRate
  const c0 = audioBuf.getChannelData(0)
  const c1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null

  const samples = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    let s = c1 ? (c0[i] + c1[i]) / 2 : c0[i]
    s = Math.max(-1, Math.min(1, s))
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const enc = new Mp3Encoder(1, rate, 128)
  const chunks: Uint8Array[] = []
  const block = 1152
  for (let i = 0; i < samples.length; i += block) {
    const buf = enc.encodeBuffer(samples.subarray(i, i + block))
    if (buf.length) chunks.push(new Uint8Array(buf))
  }
  const end = enc.flush()
  if (end.length) chunks.push(new Uint8Array(end))

  return new File(chunks as BlobPart[], 'audio.mp3', { type: 'audio/mpeg' })
}

function hora(d: string): string {
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function dataLabel(d: string): string {
  const date = new Date(d)
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(ontem.getDate() - 1)

  if (date.toDateString() === hoje.toDateString()) return 'Hoje'
  if (date.toDateString() === ontem.toDateString()) return 'Ontem'
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const convId = params.id as string
  const [name, setName] = useState('Conversa')
  const [channel, setChannel] = useState('')
  const [leadId, setLeadId] = useState<string | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [stageId, setStageId] = useState<string | null>(null)
  const [stageName, setStageName] = useState<string | null>(null)
  const [stageColor, setStageColor] = useState<string | null>(null)
  const [verEtapas, setVerEtapas] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)
  const primeiraRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [gravando, setGravando] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const [menuMsgId, setMenuMsgId] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editTexto, setEditTexto] = useState('')
  const longPressRef = useRef<{ timeout: NodeJS.Timeout; msgId: string } | null>(null)

  async function carregar() {
    try {
      const r = await fetch(`/api/app/messages?conv=${convId}`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setName(d.name); setLeadId(d.leadId); setChannel(d.channel || ''); setMsgs(d.messages || [])
        setStages(d.stages || []); setStageId(d.stageId ?? null); setStageName(d.stageName ?? null); setStageColor(d.stageColor ?? null)
      }
    } catch { /* ignora */ }
  }

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 4000)
    return () => clearInterval(t)
  }, [convId])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: primeiraRef.current ? 'auto' : 'smooth' })
    primeiraRef.current = false
  }, [msgs.length])

  async function enviar() {
    const t = texto.trim()
    if (!t || !leadId || enviando) return
    setEnviando(true)
    setTexto('')
    setMsgs((m) => [...m, { id: 'tmp-' + Date.now(), direction: 'outbound', senderType: 'human', content: t, mediaUrl: null, mediaType: null, createdAt: new Date().toISOString() }])
    try { await sendManualMessage(leadId, t); await carregar() } catch { setTexto(t) }
    setEnviando(false)
  }

  async function trocarEtapa(novoId: string) {
    if (!leadId || novoId === stageId) { setVerEtapas(false); return }
    const s = stages.find((x) => x.id === novoId)
    setStageId(novoId); setStageName(s?.name ?? null); setStageColor(s?.color ?? null); setVerEtapas(false)
    try { await moveLeadStage(leadId, novoId); await carregar() } catch { /* ignora */ }
  }

  async function encerrar() {
    if (!confirm('Encerrar esta conversa?\n\nEla sai da lista e a automação NÃO vai trazer de volta. Só reabre se o cliente mandar uma nova mensagem.')) return
    try { await encerrarConversa(convId) } catch { /* ignora */ }
    router.push('/app')
  }

  async function editarMensagem(msgId: string) {
    if (!editTexto.trim()) return
    try {
      await fetch(`/api/app/messages/${msgId}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editTexto }) })
      setEditandoId(null)
      await carregar()
    } catch { alert('Erro ao editar') }
  }

  async function deletarMensagem(msgId: string) {
    if (!confirm('Deletar mensagem?')) return
    try {
      await fetch(`/api/app/messages/${msgId}/delete`, { method: 'DELETE' })
      setMenuMsgId(null)
      await carregar()
    } catch { alert('Erro ao deletar') }
  }

  function copiarMensagem(text: string) {
    navigator.clipboard.writeText(text)
    setMenuMsgId(null)
  }

  function encaminharMensagem(text: string) {
    setTexto(text)
    setMenuMsgId(null)
  }

  async function compartilharMensagem(text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ text })
        setMenuMsgId(null)
      } catch { /* usuário cancelou */ }
    } else {
      copiarMensagem(text)
    }
  }

  function iniciarLongPress(msgId: string) {
    longPressRef.current = {
      msgId,
      timeout: setTimeout(() => setMenuMsgId(msgId), 500),
    }
  }

  function cancelarLongPress() {
    if (longPressRef.current) clearTimeout(longPressRef.current.timeout)
    longPressRef.current = null
  }

  async function uploadFile(file: File) {
    if (!leadId || enviando) return
    setEnviando(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/leads/${leadId}/send-media`, { method: 'POST', body: fd })
      if (!r.ok) {
        const e = await r.json().catch(() => null)
        alert('Não consegui enviar: ' + (e?.error || `erro ${r.status}`))
      }
      await carregar()
    } catch { alert('Falha de conexão ao enviar o arquivo.') }
    setEnviando(false)
  }

  function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return ''
    for (const c of ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']) {
      try { if (MediaRecorder.isTypeSupported(c)) return c } catch { /* ignora */ }
    }
    return ''
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recRef.current = rec
      rec.start()
      setGravando(true)
    } catch (err) {
      alert('Não consegui acessar o microfone: ' + (err instanceof Error ? err.message : String(err)) + '\n\nVerifique permissão e HTTPS.')
    }
  }

  function pararGravacao(enviarAudio: boolean) {
    const rec = recRef.current
    setGravando(false)
    if (!rec) return
    rec.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (enviarAudio && chunksRef.current.length) {
        setEnviando(true)
        try {
          const type = rec.mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type })
          if (blob.size < 100) { alert('Áudio muito curto. Tente gravar por mais tempo.'); return }
          // WhatsApp aceita MP3 como voz → converte antes de enviar
          const mp3 = await blobToMp3(blob)
          await uploadFile(mp3)
        } catch (err) {
          alert('Falha ao converter áudio: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
          setEnviando(false)
        }
      }
      chunksRef.current = []
    }
    try { rec.stop() } catch { /* ignora */ }
  }

  return (
    <>
      {/* Cabeçalho */}
      <header className="shrink-0 bg-orange-500 text-white px-3 py-3 flex items-center gap-2 shadow-md">
        <button onClick={() => router.push('/app')} className="px-1 text-2xl leading-none" aria-label="Voltar">←</button>
        <div className="w-9 h-9 rounded-full bg-white/25 flex items-center justify-center font-bold shrink-0">{name[0]?.toUpperCase() ?? '?'}</div>
        <span className="font-semibold truncate flex-1">{name}</span>
        <span className="text-sm shrink-0">{canalIcone[channel] ?? ''}</span>
        <button onClick={encerrar} title="Encerrar conversa"
          className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-white/20 text-white font-medium whitespace-nowrap">✓ Encerrar</button>
      </header>

      {/* Aba da etapa (toca pra mover) */}
      {stageName && (
        <button onClick={() => setVerEtapas((v) => !v)}
          className="shrink-0 bg-white border-b border-zinc-200 px-3 py-2 flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Etapa:</span>
          <span className="px-2 py-0.5 rounded-full border font-medium" style={{ borderColor: stageColor ?? '#cbd5e1', color: stageColor ?? '#64748b' }}>{stageName}</span>
          <span className="ml-auto text-orange-600 font-medium">trocar ▾</span>
        </button>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 bg-zinc-100">
        {msgs.map((m, i) => {
          const meu = m.direction === 'outbound'
          const dataMudou = i === 0 || new Date(msgs[i - 1]!.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
          return (
            <div key={m.id}>
              {dataMudou && (
                <div className="flex justify-center my-2">
                  <span className="text-xs text-zinc-400 bg-zinc-100 px-3 py-1">{dataLabel(m.createdAt)}</span>
                </div>
              )}
              <div className={`flex ${meu ? 'justify-end' : 'justify-start'} relative group`}>
              <div
                onContextMenu={(e) => { e.preventDefault(); setMenuMsgId(m.id) }}
                onTouchStart={() => meu && iniciarLongPress(m.id)}
                onTouchEnd={cancelarLongPress}
                onMouseDown={() => meu && iniciarLongPress(m.id)}
                onMouseUp={cancelarLongPress}
                onMouseLeave={cancelarLongPress}
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm select-none relative ${meu ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-white text-zinc-900 border border-zinc-200 rounded-bl-sm'} ${editandoId === m.id ? 'ring-2 ring-orange-400' : ''}`}>
                {m.mediaUrl && (() => {
                  const u = m.mediaUrl as string
                  const t = m.mediaType || ''
                  if (t === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(u))
                    // eslint-disable-next-line @next/next/no-img-element
                    return <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="imagem" className="rounded-lg max-w-full mb-1 max-h-72 object-contain" /></a>
                  if (t === 'audio' || /\.(ogg|mp3|m4a|aac|amr|wav)$/i.test(u))
                    return <audio controls src={u} className="mb-1 max-w-[220px]" />
                  if (t === 'video' || /\.(mp4|mov|3gp|webm)$/i.test(u))
                    return <video controls src={u} className="rounded-lg max-w-full mb-1 max-h-72" />
                  return <a href={u} target="_blank" rel="noreferrer" className={`flex items-center gap-1 text-xs underline mb-1 ${meu ? 'text-white' : 'text-orange-600'}`}>📎 Abrir arquivo</a>
                })()}
                {editandoId === m.id ? (
                  <div className="space-y-1.5">
                    <textarea value={editTexto} onChange={(e) => setEditTexto(e.target.value)} rows={2}
                      className="w-full px-2 py-1 rounded text-sm bg-white/20 text-white outline-none" />
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditandoId(null)} className="text-xs px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">Cancelar</button>
                      <button onClick={() => editarMensagem(m.id)} className="text-xs px-2 py-0.5 rounded bg-white/20 hover:bg-white/30">Salvar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    <div className={`text-[10px] mt-1 flex justify-between items-center gap-1 ${meu ? 'text-white/70' : 'text-zinc-400'}`}>
                      <span>{meu && m.senderType === 'ai' ? '🤖 ' : ''}{hora(m.createdAt)}</span>
                      {meu && (
                        <button onClick={() => setMenuMsgId(menuMsgId === m.id ? null : m.id)} className="px-2.5 py-1 rounded-lg text-base font-bold bg-white/90 text-orange-600 hover:bg-white shadow-sm transition">⋮</button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {menuMsgId === m.id && (
                <div className="fixed inset-0 z-40" onClick={() => setMenuMsgId(null)} />
              )}
              {menuMsgId === m.id && meu && (
                <div className="fixed z-50 bg-white rounded-lg shadow-2xl p-2 space-y-1 bottom-24 right-4" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setEditandoId(m.id); setEditTexto(m.content); setMenuMsgId(null) }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm rounded text-gray-900 font-medium">✏️ Editar</button>
                  <button onClick={() => copiarMensagem(m.content)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm rounded text-gray-900 font-medium">📋 Copiar</button>
                  <button onClick={() => encaminharMensagem(m.content)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm rounded text-gray-900 font-medium">➡️ Encaminhar</button>
                  <button onClick={() => compartilharMensagem(m.content)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm rounded text-gray-900 font-medium">📤 Compartilhar</button>
                  <button onClick={() => deletarMensagem(m.id)} className="w-full text-left px-4 py-2.5 hover:bg-red-50 text-sm rounded text-red-600 font-medium">🗑️ Deletar</button>
                </div>
              )}
            </div>
            </div>
          )
        })}
        <div ref={fimRef} />
      </div>

      {/* Caixa de resposta */}
      <div className="shrink-0 bg-white border-t border-zinc-200 p-2">
        <input ref={fileRef} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
        {gravando ? (
          <div className="flex items-center gap-3 px-2">
            <button onClick={() => pararGravacao(false)} className="text-zinc-500 text-xl" title="Cancelar">✕</button>
            <span className="flex-1 text-sm text-red-600 font-medium animate-pulse">🔴 Gravando áudio…</span>
            <button onClick={() => pararGravacao(true)} disabled={enviando}
              className="w-11 h-11 rounded-full bg-orange-500 text-white font-bold text-lg shrink-0" title="Enviar áudio">➤</button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <button onClick={() => fileRef.current?.click()} disabled={enviando}
              className="w-10 h-10 rounded-full text-xl text-zinc-500 shrink-0 disabled:opacity-50" title="Anexar arquivo">📎</button>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
              placeholder="Mensagem…"
              className="flex-1 px-3 py-2 rounded-2xl border border-zinc-300 bg-white text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-orange-300 resize-none max-h-32" />
            {texto.trim() ? (
              <button onClick={enviar} disabled={enviando}
                className="w-11 h-11 rounded-full bg-orange-500 text-white font-bold text-lg disabled:opacity-50 shrink-0" title="Enviar">➤</button>
            ) : (
              <button onClick={iniciarGravacao} disabled={enviando}
                className="w-11 h-11 rounded-full bg-orange-500 text-white text-xl disabled:opacity-50 shrink-0" title="Gravar áudio">🎤</button>
            )}
          </div>
        )}
      </div>

      {/* Painel de etapas */}
      {verEtapas && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-end" onClick={() => setVerEtapas(false)}>
          <div className="bg-white w-full rounded-t-2xl p-3 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold mb-2 px-1 text-zinc-900">Mover para a etapa…</div>
            {stages.map((s) => (
              <button key={s.id} onClick={() => trocarEtapa(s.id)}
                className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-2 active:bg-zinc-100 ${s.id === stageId ? 'bg-zinc-100' : ''}`}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color ?? '#cbd5e1' }} />
                <span className="text-sm text-zinc-900">{s.name}</span>
                {s.id === stageId && <span className="ml-auto text-xs text-zinc-400">atual</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
