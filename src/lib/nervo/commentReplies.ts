// Respostas a comentários do Facebook/Instagram escritas no CRM (14/11/2026). O CRM grava a resposta
// (SocialCommentReply, id = requestId), pede ao Mind Marketing (`social.comment.reply`) e o Marketing
// responde na Meta e confirma (`social.comment.replied`). Falha nunca é silenciosa: fica na tela de Comentários.
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { SocialCommentReplied } from './socialMessages'
import { motivoFalhaComentario } from './socialMessages'

export type ResultadoResposta = { ok: boolean; erro?: string }

/** Grava a resposta e pede ao Marketing para publicá-la no comentário. */
export async function responderComentario(engagementId: string, texto: string, authorUserId?: string): Promise<ResultadoResposta> {
  const text = texto.trim()
  if (!text) return { ok: false, erro: 'Escreva a resposta.' }
  if (text.length > 8000) return { ok: false, erro: 'Resposta longa demais.' }
  const eng = await prisma.socialEngagement.findUnique({ where: { id: engagementId }, select: { id: true, kind: true, channel: true, externalId: true } })
  if (!eng || eng.kind !== 'comment') return { ok: false, erro: 'Comentário não encontrado.' }
  if (eng.channel !== 'facebook' && eng.channel !== 'instagram') return { ok: false, erro: 'Canal não suportado.' }

  const { getCrmNervo } = await import('./fromEnv')
  const { loadNervoConfig } = await import('./config')
  const nervo = getCrmNervo()
  const cfg = loadNervoConfig(process.env, { publicAppUrl: process.env.NEXT_PUBLIC_APP_URL, sealSecret: process.env.SESSION_SECRET })
  if (!nervo || cfg.status !== 'ready') return { ok: false, erro: 'O CRM não está conectado ao Mind (Nervo desligado).' }

  const reply = await prisma.socialCommentReply.create({ data: { engagementId: eng.id, text, authorUserId: authorUserId ?? null } })
  const r = await nervo.publishSocialCommentReply({
    clientAccountId: cfg.config.mindMarketingClientAccountId, channel: eng.channel, commentId: eng.externalId, text, requestId: reply.id,
  })
  if (r === 'queued') return { ok: true }
  const erro = r === 'unpaired'
    ? 'Não enviado: o CRM ainda não está conectado ao Mind (aceite o pareamento no painel do Mind).'
    : 'Não enviado: falha ao falar com o Mind. Tente de novo.'
  await prisma.socialCommentReply.update({ where: { id: reply.id }, data: { status: 'failed', error: erro } })
  return { ok: false, erro }
}

/** `social.comment.replied` → marca respondida (id da resposta na Meta) ou a falha. Idempotente. */
export async function marcarRespostaComentario(result: SocialCommentReplied): Promise<void> {
  const reply = await prisma.socialCommentReply.findUnique({ where: { id: result.requestId }, select: { id: true } })
  if (!reply) return
  await prisma.socialCommentReply.update({
    where: { id: reply.id },
    data: result.ok
      ? { status: 'sent', replyExternalId: result.replyId ?? null, error: null }
      : { status: 'failed', error: motivoFalhaComentario(result.error) },
  })
}
