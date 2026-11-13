import 'server-only'
import { enviarEmail, type SmtpConfig } from '@lib/email-smtp'

/**
 * 📧 Notificação por e-mail de LEAD NOVO (chat do site / API pública).
 * Destino: LEAD_NOTIFY_EMAIL (padrão contato@kerosolar.com.br).
 * SMTP configurado nas variáveis do Railway: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_FROM (opcional; padrão = SMTP_USER), SMTP_SECURE ("true" para porta 465).
 * Silencioso: nunca lança erro (não pode atrapalhar o atendimento).
 */
export type LeadEmailDados = {
  nome?: string | null
  telefone?: string | null
  email?: string | null
  cidade?: string | null
  mensagem?: string | null
  origem?: string | null
  leadId?: string | null
}

function smtpDoAmbiente(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim()
  const user = process.env.SMTP_USER?.trim()
  if (!host || !user) return null
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465
  const from = process.env.SMTP_FROM?.trim() || `KeroSolar CRM <${user}>`
  return { host, port, secure, user, pass: process.env.SMTP_PASS ?? '', from, heloName: 'kerosolar-crm' }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/**
 * O Railway bloqueia SMTP de saída no plano atual → o envio passa pelo SITE (Vercel), que manda
 * pelo SMTP da Kerosolar. LEAD_EMAIL_RELAY_URL = https://www.kerosolar.com.br/api/lead
 * Autenticado com a mesma chave do webchat (WEBCHAT_API_KEY), no header x-relay-key.
 */
async function enviarPeloSite(d: LeadEmailDados): Promise<boolean | null> {
  const url = process.env.LEAD_EMAIL_RELAY_URL?.trim()
  if (!url) return null
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  const crmLink = d.leadId && base ? `${base.replace(/\/$/, '')}/leads/${d.leadId}` : undefined
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-relay-key': process.env.WEBCHAT_API_KEY ?? '' },
    body: JSON.stringify({ name: d.nome || 'Visitante do chat', phone: d.telefone, email: d.email, city: d.cidade, message: d.mensagem, source: d.origem || 'Chat do site', crmLink }),
    signal: AbortSignal.timeout(30000),
  })
  const txt = await res.text().catch(() => '')
  if (!res.ok) { console.error('[lead-email] site recusou (%d): %s', res.status, txt.slice(0, 200)); return false }
  console.log('[lead-email] enviado pelo site (%s)', url)
  return true
}

export async function notificarLeadPorEmail(d: LeadEmailDados): Promise<boolean> {
  try {
    const peloSite = await enviarPeloSite(d)
    if (peloSite !== null) return peloSite
    const cfg = smtpDoAmbiente()
    if (!cfg) { console.warn('[lead-email] SMTP não configurado (SMTP_HOST/SMTP_USER) — e-mail de lead novo não enviado'); return false }
    const para = (process.env.LEAD_NOTIFY_EMAIL || 'contato@kerosolar.com.br').split(',').map((s) => s.trim()).filter(Boolean)

    const linhas: [string, string][] = [
      ['Nome', d.nome || '—'],
      ['Telefone', d.telefone || '—'],
      ['E-mail', d.email || '—'],
      ['Cidade', d.cidade || '—'],
      ['Origem', d.origem || 'Site (chat)'],
      ['Mensagem', d.mensagem || '—'],
    ]
    const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
    const link = d.leadId && base ? `${base.replace(/\/$/, '')}/leads/${d.leadId}` : ''

    const text = `Novo lead recebido pelo site\n\n${linhas.map(([k, v]) => `${k}: ${v}`).join('\n')}${link ? `\n\nAbrir no CRM: ${link}` : ''}\n`
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">☀️ Novo lead recebido pelo site</h2>
<table cellpadding="6" style="border-collapse:collapse">${linhas.map(([k, v]) =>
  `<tr><td style="font-weight:bold;vertical-align:top;border-bottom:1px solid #eee">${esc(k)}</td><td style="border-bottom:1px solid #eee;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>
${link ? `<p style="margin-top:16px"><a href="${esc(link)}">Abrir o lead no CRM</a></p>` : ''}
</div>`

    const assunto = `Novo lead: ${(d.nome || 'sem nome').replace(/[\r\n]+/g, ' ').slice(0, 80)}${d.cidade ? ` — ${d.cidade.replace(/[\r\n]+/g, ' ').slice(0, 40)}` : ''}`
    const replyTo = d.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(d.email) ? d.email : undefined
    const r = await enviarEmail(cfg, { to: para, subject: assunto, text, html, replyTo })
    console.log('[lead-email] enviado para %s (%s)', r.accepted.join(', '), r.response.slice(0, 60))
    return true
  } catch (e) {
    console.error('[lead-email] falhou:', e instanceof Error ? e.message : e)
    return false
  }
}
