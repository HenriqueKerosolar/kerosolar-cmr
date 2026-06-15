import { prisma } from "../src/lib/prisma"
async function main() {
  const c = await prisma.contact.findFirst({ where: { phone: "5521995330441" } })
  console.log("CONTATO", c?.id, "| nome:", c?.name, "| phone:", c?.phone, "| waId:", c?.whatsappId)
  const convs = await prisma.conversation.findMany({ where: { contactId: c!.id } })
  for (const cv of convs) {
    console.log("CONV", cv.id, "| channel:", cv.channel, "| accountId:", cv.accountId, "| chatJid:", cv.chatJid, "| externalId:", cv.externalId, "| leadId:", cv.leadId)
    const msgs = await prisma.message.findMany({ where: { conversationId: cv.id }, orderBy: { createdAt: "desc" }, take: 3 })
    for (const m of msgs) console.log("   MSG", m.direction, m.senderType, "| extId:", m.externalId, "|", (m.content||"").slice(0,40))
  }
  const accts = await prisma.whatsappAccount.findMany()
  for (const a of accts) console.log("WAACCOUNT", a.id, "| status:", a.status)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
