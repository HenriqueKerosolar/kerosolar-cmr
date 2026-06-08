export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()

  // Reconecta todas as contas que estavam ativas (connected / qr / connecting) antes do restart
  // Delay de 3s para o banco estar pronto antes de começar as reconexões
  setTimeout(async () => {
    try {
      const { reconnectAllOnStartup } = await import('@/lib/crm/whatsapp')
      await reconnectAllOnStartup()
    } catch (e) {
      console.error('[instrumentation] restore wa:', e)
    }
  }, 3000)
}
