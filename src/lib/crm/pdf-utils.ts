import 'server-only'
import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** Extrai texto de um PDF usando pdftotext (poppler). */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const tmp = join(tmpdir(), `bill_${Date.now()}.pdf`)
  await writeFile(tmp, buf)
  return new Promise((resolve) => {
    execFile('pdftotext', [tmp, '-'], (err, stdout) => {
      unlink(tmp).catch(() => {})
      if (err || !stdout.trim()) resolve('')
      else resolve(stdout.trim().slice(0, 4000))
    })
  })
}

/**
 * Tenta extrair dados-chave de uma conta de luz do texto bruto do PDF.
 * Retorna um resumo estruturado. Se não encontrar dados de conta, retorna só o cabeçalho.
 */
export function parseBillText(raw: string): string {
  const brl = (s: string) => { const m = s.match(/r\$\s*([\d.,]+)/i); return m ? parseFloat(m[1].replace(/\./g,'').replace(',','.')) : null }

  // 1) Consumo kWh
  let kwh: number | null = null
  const quantMatch = raw.match(/quant\.?\s*\n?\s*(\d{2,4})\s*(?:\n|$)/i)
  if (quantMatch) kwh = parseInt(quantMatch[1])
  if (!kwh) { const m = raw.match(/([\d.]+)\s*kwh/i); if (m) kwh = parseFloat(m[1].replace('.','')) }
  if (!kwh) { const m = raw.match(/kwh\D{0,10}?([\d.]+)/i); if (m) kwh = parseFloat(m[1].replace('.','')) }
  if (!kwh) { const m = raw.match(/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}[^0-9]{0,20}(\d{3,4})/i); if (m) kwh = parseInt(m[1]) }

  // 2) Valor total a pagar
  let valor: number | null = null
  const valorMatch = raw.match(/(?:valor\s+a\s+pagar|total\s+a\s+pagar|r\$)\s*\n?\s*([\d.,]+)/i)
  if (valorMatch) valor = parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.'))
  if (!valor) { const m = raw.match(/r\$\s*([\d.,]+)/i); if (m) valor = parseFloat(m[1].replace(/\./g,'').replace(',','.')) }

  // 3) Tipo de ligação
  const tn = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  let medidor = ''
  if (/trifas/i.test(tn)) medidor = 'trifásico'
  else if (/bifas/i.test(tn)) medidor = 'bifásico'
  else if (/monofas/i.test(tn)) medidor = 'monofásico'

  // 4) Distribuidora
  let distrib = ''
  if (/enel|ampla|coelce/i.test(tn)) distrib = 'ENEL'
  else if (/light/i.test(tn)) distrib = 'Light'
  else if (/cpfl/i.test(tn)) distrib = 'CPFL'
  else if (/cemig/i.test(tn)) distrib = 'CEMIG'
  else if (/copel/i.test(tn)) distrib = 'COPEL'
  else if (/celesc/i.test(tn)) distrib = 'CELESC'
  else if (/energisa/i.test(tn)) distrib = 'Energisa'
  else if (/rge|rio grande energia/i.test(tn)) distrib = 'RGE'
  else if (/elektro/i.test(tn)) distrib = 'Elektro'

  const parts: string[] = ['=== DADOS EXTRAÍDOS DA CONTA ===']
  if (kwh)    parts.push(`Consumo: ${kwh} kWh/mês`)
  if (valor)  parts.push(`Valor a pagar: R$ ${valor.toFixed(2).replace('.',',')}`)
  if (medidor) parts.push(`Medidor: ${medidor}`)
  if (distrib) parts.push(`Distribuidora: ${distrib}`)
  parts.push('=================================')

  return parts.join('\n')
}

/**
 * Verifica se o texto extraído de um PDF é de uma conta de luz.
 * Retorna true se encontrou dados de consumo em kWh.
 */
export function isBillPdf(summary: string): boolean {
  return /consumo:/i.test(summary)
}
