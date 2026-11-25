export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()

  // 🩺 Monitor de mensagens de entrada: avisa o dono se o CRM parar de receber.
  const { startInboundMonitor } = await import('@/lib/crm/monitor-inbox')
  startInboundMonitor()

  // 🛟 Resposta garantida: cliente nunca fica sem resposta (mesmo se o servidor reiniciar no meio).
  const { iniciarRespostaGarantida } = await import('@/lib/crm/resposta-garantida')
  iniciarRespostaGarantida()

  // 🔗 Nervo (Mind): passada de segurança 1 min após subir (reenvia respostas de DM que ficaram pendentes na
  //    caixa de saída durável antes de um reinício) e depois UMA vez por dia — regra do dono: nada de cron em
  //    minutos; o envio normal sai na hora do evento. Desligado (no-op) sem NERVO_BASE_URL.
  const passadaNervo = async () => {
    try {
      const { getCrmNervo } = await import('@/lib/nervo/fromEnv')
      await getCrmNervo()?.tick()
    } catch (e) {
      console.error('[nervo] passada diária falhou', e)
    }
  }
  setTimeout(passadaNervo, 60_000)
  setInterval(passadaNervo, 24 * 60 * 60 * 1000)
}
