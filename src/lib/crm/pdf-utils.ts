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

  // 1) Consumo kWh — valida faixa realista (20 a 50.000 kWh).
  let kwh: number | null = null
  const noRange = (n: number) => n >= 20 && n <= 50000

  // 1a) MÉDIA ANUAL — se a fatura tiver HISTÓRICO DE CONSUMO (vários meses, ex.: "MAI/26 ... 538"),
  //     soma todos os meses e tira a média (o orçamento solar é feito pela média anual, não 1 mês).
  const historico: number[] = []
  for (const m of raw.matchAll(/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}[^\d]{0,25}?(\d{2,5})/gi)) {
    const n = parseInt(m[1], 10)
    if (n >= 50 && n <= 50000) historico.push(n)   // >= 50 evita pegar a coluna de "nº de dias" (~28-33)
  }
  if (historico.length >= 3) {
    kwh = Math.round(historico.reduce((a, b) => a + b, 0) / historico.length)
  }

  // 1b) Fallback: um único valor de consumo (quando não há histórico de vários meses).
  if (!kwh) {
    const cands: number[] = []
    const push = (s?: string) => { if (s) { const n = parseInt(s.replace(/\D/g, ''), 10); if (!isNaN(n)) cands.push(n) } }
    push(raw.match(/quant\.?\s*\n?\s*(\d{2,4})\s*(?:\n|$)/i)?.[1])
    push(raw.match(/consumo[^0-9]{0,30}?(\d{2,5})\s*kwh/i)?.[1])
    push(raw.match(/(\d{2,5})\s*kwh/i)?.[1])
    push(raw.match(/kwh\D{0,10}?(\d{2,5})/i)?.[1])
    push(raw.match(/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}[^0-9]{0,20}(\d{3,4})/i)?.[1])
    for (const c of cands) { if (noRange(c)) { kwh = c; break } }
  }

  // 2) Valor total a pagar — valida faixa realista (R$ 30 a R$ 100.000)
  let valor: number | null = null
  const valorOk = (n: number) => !isNaN(n) && n >= 30 && n <= 100000
  const valorMatch = raw.match(/(?:valor\s+a\s+pagar|total\s+a\s+pagar)\s*\n?\s*r?\$?\s*([\d.,]+)/i)
  if (valorMatch) { const v = parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')); if (valorOk(v)) valor = v }
  if (!valor) {
    // tenta todos os "R$ ..." e fica com o primeiro na faixa válida
    for (const m of raw.matchAll(/r\$\s*([\d.,]+)/gi)) {
      const v = parseFloat(m[1].replace(/\./g,'').replace(',','.'))
      if (valorOk(v)) { valor = v; break }
    }
  }

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
  // É conta de luz se extraiu consumo OU valor a pagar (alguns PDFs só dão um deles de forma confiável)
  return /consumo:|valor a pagar:/i.test(summary)
}
