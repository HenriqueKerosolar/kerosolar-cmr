import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true }, include: { stages: { orderBy: { sortOrder: 'asc' } } } })
  for (const s of pipeline?.stages ?? []) {
    const flow = s.flow as any
    console.log(`\n--- ${s.name} ---`)
    if (flow?.openingMessages?.length) {
      console.log('  Mensagens de abertura:')
      for (const m of flow.openingMessages) {
        console.log(`    [${m.delaySeconds}s] ${m.text?.slice(0,80)}`)
      }
    }
    if (flow?.blocks?.length) console.log(`  Blocos: ${flow.blocks.length} blocos`)
    if (flow?.noReplyMinutes) console.log(`  Sem resposta em ${flow.noReplyMinutes} min → move para outra etapa`)
    if (!flow?.openingMessages?.length && !flow?.blocks?.length) console.log('  (sem automação configurada)')
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
