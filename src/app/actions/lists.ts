'use server'

import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'
import { addNaLista, removeDaLista, type ListKind } from '@/lib/crm/lists'

export async function addToList(phone: string, kind: ListKind, reason?: string) {
  await verifySession()
  if (!phone?.trim()) return
  await addNaLista(phone, kind, reason?.trim() || undefined)
  revalidatePath('/listas')
}

export async function removeFromList(phone: string, kind: ListKind) {
  await verifySession()
  await removeDaLista(phone, kind)
  revalidatePath('/listas')
}
