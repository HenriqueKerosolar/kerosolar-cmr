export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()

  // Religa as contas de WhatsApp que estavam conectadas antes do restart
  try {
    const { prisma } = await import('@/lib/prisma')
    const { startSession } = await import('@/lib/crm/whatsapp')
    const connected = await prisma.whatsappAccount.findMany({ where: { status: 'connected' }, select: { id: true } })
    for (const a of connected) startSession(a.id).catch(() => {})
  } catch (e) {
    console.error('[instrumentation] restore wa', e)
  }
}
