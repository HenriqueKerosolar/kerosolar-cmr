import { verifySession } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ContatosPage() {
  await verifySession()
  const contacts = await prisma.contact.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { leads: { where: { status: 'open' }, take: 1, include: { stage: true } } },
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold">Contatos</h1>
      <p className="text-sm text-[--muted-foreground]">{contacts.length} contatos</p>

      <div className="overflow-x-auto rounded-xl border border-[--border]">
        <table className="w-full text-sm">
          <thead className="border-b border-[--border] bg-[--muted]/30">
            <tr>
              {['Nome', 'Telefone', 'E-mail', 'Lead ativo', 'Etapa'].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-[--muted-foreground]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[--border]">
            {contacts.map((c) => {
              const lead = c.leads[0]
              return (
                <tr key={c.id} className="hover:bg-[--accent]/50 transition">
                  <td className="px-4 py-3 font-medium">{c.name ?? '—'}</td>
                  <td className="px-4 py-3 text-[--muted-foreground]">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-[--muted-foreground]">{c.email ?? '—'}</td>
                  <td className="px-4 py-3">{lead ? lead.title : <span className="text-[--muted-foreground]">—</span>}</td>
                  <td className="px-4 py-3">
                    {lead ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border"
                        style={{ borderColor: lead.stage.color ?? undefined }}>
                        {lead.stage.name}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
            {contacts.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[--muted-foreground]">Nenhum contato ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
