export async function register() {
  // Só no runtime Node (não no edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startScheduler } = await import('@/lib/crm/flow')
  startScheduler()
}
