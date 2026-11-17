import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { limparMidiaAntiga } from './media-limpeza'

const DIA = 24 * 60 * 60 * 1000

function pasta(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'))
}
function arquivo(dir: string, nome: string, idadeDias: number, agora: number, conteudo = 'x'.repeat(10)): string {
  const p = path.join(dir, nome)
  fs.writeFileSync(p, conteudo)
  const t = new Date(agora - idadeDias * DIA)
  fs.utimesSync(p, t, t)
  return p
}

describe('limparMidiaAntiga', () => {
  it('apaga só o que passou do prazo e conta os bytes liberados', () => {
    const dir = pasta()
    const agora = Date.now()
    const velho = arquivo(dir, 'in_velho.jpg', 120, agora)
    const noLimite = arquivo(dir, 'in_89.jpg', 89, agora)
    const novo = arquivo(dir, 'in_novo.pdf', 1, agora)
    const r = limparMidiaAntiga(dir, agora, 90)
    expect(r).toEqual({ apagados: 1, bytes: 10, restantes: 2 })
    expect(fs.existsSync(velho)).toBe(false)
    expect(fs.existsSync(noLimite)).toBe(true)
    expect(fs.existsSync(novo)).toBe(true)
  })

  it('não entra em subpasta nem apaga pasta, mesmo antiga', () => {
    const dir = pasta()
    const agora = Date.now()
    const sub = path.join(dir, 'sessao')
    fs.mkdirSync(sub)
    const dentro = arquivo(sub, 'credencial.json', 400, agora)
    const t = new Date(agora - 400 * DIA)
    fs.utimesSync(sub, t, t)
    const r = limparMidiaAntiga(dir, agora, 90)
    expect(r.apagados).toBe(0)
    expect(fs.existsSync(dentro)).toBe(true)
  })

  it('pasta que não existe não lança e não apaga nada', () => {
    expect(limparMidiaAntiga(path.join(os.tmpdir(), 'nao-existe-' + Date.now()), Date.now(), 90)).toEqual({ apagados: 0, bytes: 0, restantes: 0 })
  })
})
