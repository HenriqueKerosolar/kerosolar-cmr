import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const templates = await prisma.whatsappTemplate.findMany()
  let updated = 0
  for (const t of templates) {
    if (t.bodyText.includes('PARAR')) { console.log(`✓ já tem opt-out: ${t.name}`); continue }
    const newBody = t.bodyText + '\n\nPara não receber mais mensagens, responda PARAR.'
    await prisma.whatsappTemplate.update({ where: { id: t.id }, data: { bodyText: newBody } })
    console.log(`✅ atualizado: ${t.name}`)
    updated++
  }
  console.log(`\n${updated} templates atualizados.`)
}
main().catch(console.error).finally(() => prisma.$disconnect())
