import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const templates = await prisma.whatsappTemplate.findMany({ orderBy: { name: 'asc' } })
  for (const t of templates) {
    const status = t.metaStatus ?? 'desconhecido'
    const icon = status === 'APPROVED' ? '✅' : status === 'PENDING' ? '⏳' : status === 'REJECTED' ? '❌' : '❓'
    console.log(`${icon} ${status.padEnd(10)} ${t.name}`)
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
