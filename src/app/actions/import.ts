'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'

export type ImportRow = {
  name: string
  phone: string
  email: string
  value: string
  notes: string
}

export type ImportResult = {
  imported: number
  skipped: number
  errors: string[]
}

/**
 * Importa leads de um CSV (já parseado no client) para uma etapa específica.
 * Pula linhas sem nome E sem telefone. Evita duplicatas por telefone.
 */
export async function importLeads(
  rows: ImportRow[],
  stageId: string,
  pipelineId: string,
): Promise<ImportResult> {
  await verifySession()

  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  if (!stage) throw new Error('Etapa não encontrada.')

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    const name  = row.name?.trim()  || null
    const phone = row.phone?.replace(/\D/g, '') || null
    const email = row.email?.trim() || null
    const value = parseFloat(row.value?.replace(/[^\d.,]/g, '').replace(',', '.')) || 0
    const note  = row.notes?.trim() || null

    if (!name && !phone) { skipped++; continue }

    try {
      // Checa duplicata por telefone
      if (phone) {
        const dup = await prisma.contact.findFirst({ where: { OR: [{ phone }, { whatsappId: phone }] } })
        if (dup) {
          const dupLead = await prisma.lead.findFirst({ where: { contactId: dup.id, status: 'open' } })
          if (dupLead) { skipped++; continue }
        }
      }

      // Cria ou reutiliza contato
      let contact = phone
        ? await prisma.contact.findFirst({ where: { phone } })
        : null
      if (!contact) {
        contact = await prisma.contact.create({
          data: { name, phone, whatsappId: phone, email },
        })
      }

      // Cria lead
      const lead = await prisma.lead.create({
        data: {
          title: name || phone || 'Lead importado',
          pipelineId,
          stageId,
          contactId: contact.id,
          value,
          source: 'simulator', // marca como importado
        },
      })

      // Nota de origem
      await prisma.note.create({
        data: { leadId: lead.id, type: 'system', content: `Lead importado via CSV.${note ? ' Obs: ' + note : ''}` },
      })

      imported++
    } catch (e) {
      errors.push(`${name || phone}: ${e instanceof Error ? e.message : 'erro'}`)
    }
  }

  revalidatePath('/leads')
  return { imported, skipped, errors }
}
