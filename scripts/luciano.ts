import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const f=(d:any)=>new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
async function main(){
  const cs=await prisma.contact.findMany({where:{name:{contains:'luciano',mode:'insensitive'}},select:{id:true,name:true,phone:true,whatsappId:true,createdAt:true}})
  console.log(`Contatos "Luciano": ${cs.length}`)
  for(const c of cs){
    const leads=await prisma.lead.findMany({where:{contactId:c.id},select:{id:true,createdAt:true,stage:{select:{name:true}}}})
    const conv=await prisma.conversation.findFirst({where:{contactId:c.id},orderBy:{lastMessageAt:'desc'},select:{id:true,chatJid:true}})
    const cnt=conv?await prisma.message.count({where:{conversationId:conv.id}}):0
    console.log(`\n${c.name} | phone=${c.phone} wid=${c.whatsappId} | contato criado ${f(c.createdAt)}`)
    console.log(`  chatJid=${conv?.chatJid} | ${cnt} msgs`)
    for(const l of leads) console.log(`  lead [${l.stage?.name}] criado ${f(l.createdAt)}`)
  }
  await prisma.$disconnect()
}
main().catch(e=>{console.error(e);process.exit(1)})
