import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { liberarEspaco } from './media-limpeza'

describe('liberarEspaco (disco cheio, 26/11/2026)', () => {
  it('apaga os mais antigos até liberar o alvo e protege os recentes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'))
    const agora = Date.now(), dia = 86400000
    const criar = (nome: string, diasAtras: number) => {
      const f = path.join(dir, nome); fs.writeFileSync(f, Buffer.alloc(1000))
      const t = new Date(agora - diasAtras * dia); fs.utimesSync(f, t, t)
    }
    criar('a', 30); criar('b', 20); criar('c', 10); criar('d', 1)
    const r = liberarEspaco(dir, 1500, agora)
    expect(r.apagados).toBe(2)
    expect(fs.readdirSync(dir).sort()).toEqual(['c', 'd'])
    const r2 = liberarEspaco(dir, 10_000, agora)
    expect(fs.readdirSync(dir)).toEqual(['d'])
    expect(r2.apagados).toBe(1)
    fs.rmSync(dir, { recursive: true })
  })
})