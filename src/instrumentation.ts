export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // 🛑 Desligamento gracioso: antes de o container reiniciar (deploy), o Railway manda SIGTERM.
  // Esperamos as mensagens do WhatsApp em processamento terminarem (salvar no banco) antes de
  // sair — assim o deploy NÃO perde lead. Cap de ~18s (cabe na janela do Railway).
  const g = globalThis as unknown as { __waShutdownHooked?: boolean }
  if (!g.__waShutdownHooked) {
    g.__waShutdownHooked = true
    const shutdown = async (sig: string) => {
      try {
        const { aguardarProcessamento, emProcessamento } = await import('@/lib/crm/whatsapp')
        console.log(`[shutdown] ${sig} — aguardando ${emProcessamento()} msg(s) em processamento…`)
        await aguardarProcessamento(18000)
        console.log('[shutdown] processamento drenado, encerrando.')
      } catch (e) {
        console.error('[shutdown]', e)
      } finally {
        process.exit(0)
      }
    }
    process.once('SIGTERM', () => { shutdown('SIGTERM') })
    process.once('SIGINT', () => { shutdown('SIGINT') })
  }

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()

  // Reconecta todas as contas que estavam ativas (connected / qr / connecting) antes do restart
  // Delay de 3s para o banco estar pronto antes de começar as reconexões
  setTimeout(async () => {
    try {
      const { reconnectAllOnStartup, startWatchdog } = await import('@/lib/crm/whatsapp')
      await reconnectAllOnStartup()
      startWatchdog()   // 🐕 vigia: reconecta sozinho se a conexão parar de receber
    } catch (e) {
      console.error('[instrumentation] restore wa:', e)
    }
  }, 3000)
}
