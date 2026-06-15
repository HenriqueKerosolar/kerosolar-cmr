import { prisma } from "../src/lib/prisma"
async function main() {
  const desde = new Date(Date.now() - 3*60*60*1000)
  const msgs = await prisma.message.findMany({
    where: { direction: "inbound", createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" }, take: 15,
    include: { conversation: { include: { contact: true, lead: { include: { stage: true } } } } },
  })
  for (const m of msgs) {
    const cv = m.conversation
    console.log(m.createdAt.toISOString(), "|", (cv?.contact?.name || cv?.contact?.phone || cv?.contact?.whatsappId), "| convAi:", cv?.aiEnabled, "leadAi:", cv?.lead?.aiEnabled, "humanOnly:", cv?.lead?.humanOnly, "etapa:", cv?.lead?.stage?.name, "bot:", cv?.lead?.stage?.botEnabled, "|", (m.content||"").slice(0,28).replace(/\n/g," "))
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
