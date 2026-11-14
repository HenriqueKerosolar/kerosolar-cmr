import { verifyAdmin } from '@/lib/dal'
import { statusNervo } from '@/app/actions/nervo'
import { NervoPanel } from './nervo-panel'

export const dynamic = 'force-dynamic'

// 14/11/2026 — decisão do dono: UMA conexão só com a Meta (a do Mind Marketing). Esta tela deixou de salvar
// conexão própria com Facebook/Instagram (o formulário antigo ficou em meta-client.tsx, sem uso) e passou a
// mostrar a conexão com o Mind pelo Nervo, por onde as DMs chegam e as respostas voltam.
export default async function MetaPage() {
  await verifyAdmin()
  return <NervoPanel inicial={await statusNervo()} />
}
