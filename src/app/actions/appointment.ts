'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { revalidatePath } from 'next/cache'

export async function updateAppointmentStatus(id: string, status: string) {
  await verifySession()
  await prisma.appointment.update({ where: { id }, data: { status } })
  revalidatePath('/agenda')
}
