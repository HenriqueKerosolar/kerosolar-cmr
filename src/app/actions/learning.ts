'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'
import { loadAiConfig, embedText } from '@/lib/crm/ai'

/** Edita uma resposta aprendida (pergunta e/ou resposta) e recalcula o embedding da pergunta. */
export async function updateLearnedAnswer(id: string, question: string, answer: string) {
  await verifySession()
  const q = question.trim(), a = answer.trim()
  if (!q || !a) return
  const cfg = await loadAiConfig()
  const embedding = await embedText(cfg, q)
  await prisma.learnedAnswer.update({
    where: { id },
    data: { question: q, answer: a, embedding: embedding ?? undefined },
  })
  revalidatePath('/aprendizado')
}

/** Apaga uma resposta aprendida. */
export async function deleteLearnedAnswer(id: string) {
  await verifySession()
  await prisma.learnedAnswer.delete({ where: { id } })
  revalidatePath('/aprendizado')
}

/** Apaga vários aprendizados de uma vez (os marcados na tela). */
export async function deleteLearnedAnswers(ids: string[]) {
  await verifySession()
  const lista = (ids ?? []).filter((x) => typeof x === 'string' && x).slice(0, 1000)
  if (!lista.length) return 0
  const r = await prisma.learnedAnswer.deleteMany({ where: { id: { in: lista } } })
  revalidatePath('/aprendizado')
  return r.count
}

/** Adiciona manualmente uma resposta à base de conhecimento. */
export async function addLearnedAnswer(question: string, answer: string) {
  await verifySession()
  const q = question.trim(), a = answer.trim()
  if (!q || !a) return
  const cfg = await loadAiConfig()
  const embedding = await embedText(cfg, q)
  await prisma.learnedAnswer.create({ data: { question: q, answer: a, embedding: embedding ?? undefined } })
  revalidatePath('/aprendizado')
}
