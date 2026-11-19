// Etapa de entrada dos leads do SITE (formulário e chat). 19/11/2026: o código do formulário criava uma
// etapa nova "Entrou pelo Site" na posição 0 — empatada com a "Chegada" — e leads do WhatsApp passaram a
// cair nela (sem a regra de "sem resposta → Não respondeu o anúncio"). Agora usa a etapa que já existe,
// "Chegada pelo Site"; só cria se o funil não tiver nenhuma, e DEPOIS da Chegada (nunca na posição 0).
import 'server-only'
import { prisma } from '@/lib/prisma'

export async function etapaDoSite(pipelineId: string) {
  const etapas = await prisma.stage.findMany({ where: { pipelineId }, orderBy: { sortOrder: 'asc' } })
  const achada = etapas.find((s) => /^chegada pelo site$/i.test(s.name.trim()))
    ?? etapas.find((s) => /pelo site/i.test(s.name))
  if (achada) return achada
  const chegada = etapas.find((s) => /^chegada$/i.test(s.name.trim()))
  return prisma.stage.create({
    data: { pipelineId, name: 'Chegada pelo Site', color: '#10b981', sortOrder: (chegada?.sortOrder ?? 0) + 1 },
  })
}
