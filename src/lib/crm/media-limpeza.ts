import fs from 'fs'
import path from 'path'

/** Prazo de guarda dos anexos (dias). Depois disso o arquivo é apagado do disco; a mensagem continua no histórico, só o anexo deixa de abrir. */
export const MEDIA_RETENCAO_DIAS = Math.max(7, Number(process.env.MEDIA_RETENCAO_DIAS) || 90)

export interface LimpezaResultado {
  apagados: number
  bytes: number
  restantes: number
}

/**
 * Apaga da pasta de anexos os arquivos mais velhos que o prazo. Só olha arquivos soltos nessa pasta (nunca entra em subpasta nem sai dela).
 * Criada em 16/11/2026: o disco do Railway (500 MB) encheu e os anexos novos dos clientes deixaram de ser gravados (ENOSPC).
 */
export function limparMidiaAntiga(dir: string, agora: number = Date.now(), dias: number = MEDIA_RETENCAO_DIAS): LimpezaResultado {
  const r: LimpezaResultado = { apagados: 0, bytes: 0, restantes: 0 }
  let nomes: string[]
  try {
    nomes = fs.readdirSync(dir)
  } catch {
    return r
  }
  const corte = agora - dias * 24 * 60 * 60 * 1000
  for (const nome of nomes) {
    const arquivo = path.join(dir, nome)
    try {
      const st = fs.statSync(arquivo)
      if (!st.isFile()) continue
      if (st.mtimeMs < corte) {
        fs.unlinkSync(arquivo)
        r.apagados++
        r.bytes += st.size
      } else {
        r.restantes++
      }
    } catch {
      // arquivo sumiu ou não pode ser lido: segue para o próximo
    }
  }
  return r
}

const INTERVALO_MS = 6 * 60 * 60 * 1000
let ultima = 0

/** Roda a limpeza no máximo uma vez a cada 6 horas (ou na hora, com `forcar`). Nunca lança. */
export function limparMidiaSeForHora(dir: string, forcar = false): LimpezaResultado | null {
  const agora = Date.now()
  if (!forcar && agora - ultima < INTERVALO_MS) return null
  ultima = agora
  try {
    const r = limparMidiaAntiga(dir, agora)
    if (r.apagados > 0) console.log(`[media] limpeza: ${r.apagados} anexo(s) com mais de ${MEDIA_RETENCAO_DIAS} dias apagado(s), ${(r.bytes / 1048576).toFixed(1)} MB liberados, ${r.restantes} mantido(s)`)
    return r
  } catch (e) {
    console.error('[media] limpeza falhou (ignorado):', e)
    return null
  }
}
