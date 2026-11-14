'use server'

import { revalidatePath } from 'next/cache'
import { verifySession } from '@/lib/dal'
import { responderComentario } from '@/lib/nervo/commentReplies'

/** O atendente responde um comentário do Facebook/Instagram pelo CRM (o Mind Marketing publica na Meta). */
export async function responderComentarioAction(engagementId: string, texto: string) {
  const session = await verifySession()
  const r = await responderComentario(engagementId, texto, session.userId)
  revalidatePath('/social')
  return r
}
