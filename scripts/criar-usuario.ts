import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

async function main() {
  const hash = await bcrypt.hash('*A21ahgl1205', 12)
  const user = await prisma.user.upsert({
    where: { email: 'kerosolar@kerosolar.com.br' },
    update: { passwordHash: hash, isActive: true, role: 'admin', name: 'KeroSolar' },
    create: { name: 'KeroSolar', email: 'kerosolar@kerosolar.com.br', passwordHash: hash, role: 'admin', isActive: true },
  })
  console.log('OK:', user.id, user.email, user.role)
  await prisma.$disconnect()
}

main().catch(console.error)
