import { NextResponse } from 'next/server'
import path from 'path'
import { getSessionSafe } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

const MAX_BYTES = 25 * 1024 * 1024

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionSafe()
  if (!session?.userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { id: leadId } = await params

  const form = await req.formData()
  const file = form.get('file') as File | null
  const caption = ((form.get('caption') as string) || '').trim()
  if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx. 25 MB).' }, { status: 400 })

  const conv = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: 'desc' }, include: { contact: true } })
  if (!conv) return NextResponse.json({ error: 'Esse lead ainda não tem conversa.' }, { status: 400 })

  // O navegador às vezes manda o arquivo SEM tipo (Windows sem leitor de PDF registrado) e a Meta recusa
  // "application/octet-stream" — descobre pelo nome (24/11/2026: ebook não saía).
  const POR_EXT: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
  }
  const extNome = path.extname(file.name || '').toLowerCase()
  const mime = (file.type && file.type !== 'application/octet-stream') ? file.type : (POR_EXT[extNome] || 'application/octet-stream')
  const falhou = (etapa: string, motivo: string) => {
    console.error('[send-media] falhou (%s) lead=%s arquivo="%s" tipo=%s tamanho=%d: %s', etapa, leadId, file.name, mime, file.size, motivo)
  }
  if (mime === 'application/octet-stream') {
    falhou('tipo', 'tipo de arquivo desconhecido')
    return NextResponse.json({ error: `O WhatsApp não aceita esse tipo de arquivo ("${file.name}"). Envie PDF, imagem, vídeo, áudio, Word, Excel ou PowerPoint.` }, { status: 400 })
  }
  // 📄 "orça esse" na legenda de um PDF = orçamento do FORNECEDOR (ex.: híbrido): NÃO vai ao cliente (tem o custo).
  //    Vira o PDF KeroSolar com a margem e fica só para o operador, até ele escrever "envia orçamento".
  if (mime === 'application/pdf') {
    const { lerComandoOrcaEsse } = await import('@/lib/crm/belenus/pdf-fornecedor')
    const cmd = lerComandoOrcaEsse(caption)
    if (cmd) {
      try {
        const { processarPdfFornecedor } = await import('@/lib/crm/belenus/pdf-fornecedor-cmd')
        const texto = await processarPdfFornecedor(leadId, Buffer.from(await file.arrayBuffer()), cmd.margem)
        return NextResponse.json({ ok: true, info: texto })
      } catch (err) {
        falhou('orça esse', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ error: `${err instanceof Error ? err.message : 'Falha ao ler o PDF do fornecedor.'} (o PDF NÃO foi enviado ao cliente)` }, { status: 400 })
      }
    }
  }
  // Envio pelo canal da conversa (Instagram/Facebook pela ponte; WhatsApp pela API oficial) — mesma função
  // usada pelo comando "envia orçamento" (src/lib/crm/enviar-arquivo.ts).
  try {
    const { enviarArquivoNaConversa } = await import('@/lib/crm/enviar-arquivo')
    const r = await enviarArquivoNaConversa({
      leadId, conv, userId: session.userId, buffer: Buffer.from(await file.arrayBuffer()),
      nome: file.name || `arquivo${extNome}`, mime, caption,
    })
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[send-media] ERRO:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao enviar o arquivo.' }, { status: 500 })
  }
}
