export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()

  // 🩺 Monitor de mensagens de entrada: avisa o dono se o CRM parar de receber.
  const { startInboundMonitor } = await import('@/lib/crm/monitor-inbox')
  startInboundMonitor()
}
