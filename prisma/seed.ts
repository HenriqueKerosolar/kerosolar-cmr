import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  // Admin padrão
  const hash = await bcrypt.hash('kerosolar@2025', 12)
  await prisma.user.upsert({
    where: { email: 'admin@kerosolar.com.br' },
    update: {},
    create: { name: 'Administrador', email: 'admin@kerosolar.com.br', passwordHash: hash, role: 'admin' },
  })
  console.log('✓ admin criado: admin@kerosolar.com.br / kerosolar@2025')

  // Funil padrão
  let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } })
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({ data: { name: 'Funil KeroSolar', isDefault: true } })
    const stages = [
      { name: 'Novo',         color: '#3b82f6', sortOrder: 0 },
      { name: 'Qualificando', color: '#eab308', sortOrder: 1 },
      { name: 'Orçamento',    color: '#f97316', sortOrder: 2 },
      { name: 'Negociação',   color: '#a855f7', sortOrder: 3 },
      { name: 'Ganho',        color: '#22c55e', sortOrder: 4, isWon:  true },
      { name: 'Perdido',      color: '#ef4444', sortOrder: 5, isLost: true },
    ]
    await prisma.stage.createMany({ data: stages.map((s) => ({ ...s, pipelineId: pipeline!.id })) })
    console.log('✓ funil padrão criado')
  } else {
    console.log('✓ funil já existe')
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
