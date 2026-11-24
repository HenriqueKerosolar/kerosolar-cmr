// 📄 PDF do orçamento KeroSolar (Fase 3) — reproduz o modelo aprovado pelo dono (gerar_orcamento.py / reportlab)
// com pdfkit: caixas com borda #D9DCE1, títulos com linha amarela #F5B400, texto #1F2328, Helvetica.
// Biblioteca: não há peça de PDF de proposta (pedido REQ-047 registrado) → pdfkit direto aqui.

import fs from 'fs'
import path from 'path'
import PDFDocument from 'pdfkit'
import type { DadosOrcamento } from './orcamento'

const LARANJA = '#F07A12'
const AMARELO = '#F5B400'
const ESCURO = '#1F2328'
const CINZA = '#5B6169'
const BORDA = '#D9DCE1'
const FUNDO = '#F6F7F9'
const VERDE = '#1E8E3E'
const PRODUTO = '#3A3F45'
const VALIDADE = '#B45309'

const MM = 72 / 25.4
const MARGEM_X = 15 * MM
const MARGEM_Y = 12 * MM
const PAG_W = 595.28
const PAG_H = 841.89
const W = PAG_W - 2 * MARGEM_X
const PAD = 10
const ESPACO = 8

export const CAMINHO_LOGO = path.join(process.cwd(), 'public', 'orcamento', 'logo-wordmark.png')

const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: number, casas = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

type Doc = InstanceType<typeof PDFDocument>
type Estilo = { tam?: number; negrito?: boolean; cor?: string; alinhar?: 'left' | 'right' | 'center'; sublinhado?: boolean }
type Seg = { t: string; negrito?: boolean; cor?: string }
type Celula = string | { t: string; negrito?: boolean; cor?: string; segs?: Seg[] }
type Bloco = { altura: number; desenhar: (y: number) => void }

export async function gerarPdfOrcamento(d: DadosOrcamento, opts: { logo?: string | null } = {}): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: 'A4', margins: { top: MARGEM_Y, bottom: MARGEM_Y, left: MARGEM_X, right: MARGEM_X },
    info: { Title: `Orçamento KeroSolar ${d.numero} - ${d.cliente.nome}`, Author: 'KeroSolar Energia & Tecnologia' },
  })
  const partes: Buffer[] = []
  const fim = new Promise<Buffer>((ok, erro) => {
    doc.on('data', (c: Buffer) => partes.push(c))
    doc.on('end', () => ok(Buffer.concat(partes)))
    doc.on('error', erro)
  })

  // ── texto ───────────────────────────────────────────────────────────────────
  const fonte = (e: Estilo) => doc.font(e.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(e.tam ?? 9)
  const altTexto = (t: string, w: number, e: Estilo = {}) => fonte(e).heightOfString(t, { width: w, lineGap: 1.5 })
  const texto = (t: string, x: number, y: number, w: number, e: Estilo = {}) => {
    fonte(e).fillColor(e.cor ?? ESCURO).text(t, x, y, { width: w, align: e.alinhar ?? 'left', lineGap: 1.5, underline: !!e.sublinhado })
  }
  const altSegs = (segs: Seg[], w: number, tam = 9) => fonte({ tam, negrito: true }).heightOfString(segs.map((s) => s.t).join(''), { width: w, lineGap: 1.5 })
  const segs = (ss: Seg[], x: number, y: number, w: number, tam = 9, alinhar: Estilo['alinhar'] = 'left') => {
    ss.forEach((s, i) => {
      fonte({ tam, negrito: s.negrito }).fillColor(s.cor ?? ESCURO)
      const o = { width: w, lineGap: 1.5, align: alinhar, continued: i < ss.length - 1 }
      if (i === 0) doc.text(s.t, x, y, o)
      else doc.text(s.t, o)
    })
  }
  const check = (x: number, y: number, cor = ESCURO) => {
    doc.save().lineWidth(1.3).strokeColor(cor).moveTo(x, y + 4).lineTo(x + 2.6, y + 6.8).lineTo(x + 7, y + 0.6).stroke().restore()
  }

  // ── paginação ───────────────────────────────────────────────────────────────
  let y = MARGEM_Y
  const limite = PAG_H - MARGEM_Y
  const colocar = (b: Bloco, espaco = ESPACO) => {
    if (y + b.altura > limite && y > MARGEM_Y + 1) { doc.addPage(); y = MARGEM_Y }
    b.desenhar(y)
    y += b.altura + espaco
  }

  /** Caixa com borda: conteúdo medido antes (altura) e desenhado depois. */
  const caixa = (alturaConteudo: number, desenhar: (x: number, y: number, w: number) => void, fundo?: string): Bloco => ({
    altura: alturaConteudo + 2 * PAD,
    desenhar: (yy) => {
      doc.save().lineWidth(0.8).strokeColor(BORDA)
      if (fundo) doc.fillColor(fundo).rect(MARGEM_X, yy, W, alturaConteudo + 2 * PAD).fillAndStroke(fundo, BORDA)
      else doc.rect(MARGEM_X, yy, W, alturaConteudo + 2 * PAD).stroke()
      doc.restore()
      desenhar(MARGEM_X + PAD, yy + PAD, W - 2 * PAD)
    },
  })

  /** Título com linha amarela (esquerda grande, direita pequena). */
  const ALT_TITULO = 22
  const titulo = (x: number, yy: number, w: number, esq: string, dir = '', comCheck = false) => {
    texto(esq, x, yy, w * 0.6, { tam: 11.5, negrito: true })
    if (dir) {
      const wd = fonte({ tam: 8, negrito: true }).widthOfString(dir)
      texto(dir, x + w * 0.4, yy + 3, w * 0.6, { tam: 8, negrito: true, alinhar: 'right' })
      if (comCheck) check(x + w - wd - 11, yy + 3)
    }
    doc.save().lineWidth(2).strokeColor(AMARELO).moveTo(x, yy + 18).lineTo(x + w, yy + 18).stroke().restore()
  }

  /** Tabela com grade (cabeçalho com fundo). */
  const celTexto = (c: Celula) => (typeof c === 'string' ? c : c.segs ? c.segs.map((s) => s.t).join('') : c.t)
  const tabela = (larguras: number[], linhas: Celula[][], opt: { cabecalho?: boolean; grade?: boolean; padV?: number } = {}) => {
    const padV = opt.padV ?? 5, padH = 5
    const alturas = linhas.map((l, i) => Math.max(...l.map((c, j) => {
      const neg = typeof c !== 'string' && !!c.negrito || (opt.cabecalho !== false && i === 0)
      return altTexto(celTexto(c), larguras[j] - 2 * padH, { negrito: neg })
    })) + 2 * padV)
    const altura = alturas.reduce((a, b) => a + b, 0)
    const desenhar = (x: number, yy: number) => {
      let cy = yy
      linhas.forEach((l, i) => {
        let cx = x
        const h = alturas[i]
        if (i === 0 && opt.cabecalho !== false) doc.save().rect(x, cy, larguras.reduce((a, b) => a + b, 0), h).fill(FUNDO).restore()
        l.forEach((c, j) => {
          const neg = typeof c !== 'string' && !!c.negrito || (opt.cabecalho !== false && i === 0)
          const th = altTexto(celTexto(c), larguras[j] - 2 * padH, { negrito: neg })
          const ty = cy + (h - th) / 2
          if (typeof c !== 'string' && c.segs) segs(c.segs, cx + padH, ty, larguras[j] - 2 * padH)
          else texto(celTexto(c), cx + padH, ty, larguras[j] - 2 * padH, { negrito: neg, cor: typeof c !== 'string' ? c.cor : undefined })
          if (opt.grade !== false) doc.save().lineWidth(0.5).strokeColor(BORDA).rect(cx, cy, larguras[j], h).stroke().restore()
          cx += larguras[j]
        })
        cy += h
      })
    }
    return { altura, desenhar }
  }

  // ── 1) Cabeçalho ───────────────────────────────────────────────────────────
  {
    const wDir = W - 2 * PAD - 62 * MM
    const linhasDir: [string, Estilo][] = [
      ['KEROSOLAR ENERGIA & TECNOLOGIA', { tam: 8, negrito: true, alinhar: 'right', sublinhado: true }],
      ['CNPJ: 34.307.552/0001-69', { tam: 8, negrito: true, alinhar: 'right' }],
      ['R A, 37 CASA 01 - VILA PROGRESSO', { tam: 8, negrito: true, alinhar: 'right' }],
      ['Niterói - RJ   CEP: 24320-480', { tam: 8, negrito: true, alinhar: 'right' }],
      ['FONE / WHATSAPP: (21) 2027-6013', { tam: 8, negrito: true, alinhar: 'right' }],
      ['kerosolar@kerosolar.com.br · www.kerosolar.com.br', { tam: 8, negrito: true, alinhar: 'right' }],
    ]
    const altTit = altTexto(`Orçamento ${d.numero}`, wDir, { tam: 15, negrito: true }) + 4
    const altDir = altTit + linhasDir.reduce((s, [t, e]) => s + altTexto(t, wDir, e), 0)
    const altCab = Math.max(altDir, 16 * MM)
    const emissao = `Emissão em ${d.emissao}, válido por 3 dias ou enquanto durarem os estoques.`
    const altEm = altTexto(emissao, W - 2 * PAD, { tam: 8, negrito: true })
    colocar(caixa(altCab + 8 + altEm, (x, yy, w) => {
      const logo = opts.logo === undefined ? CAMINHO_LOGO : opts.logo
      if (logo && fs.existsSync(logo)) doc.image(logo, x, yy + (altCab - 16 * MM) / 2, { fit: [62 * MM, 16 * MM] })
      else texto('KeroSolar', x, yy + 8, 62 * MM, { tam: 22, negrito: true, cor: LARANJA })
      const xd = x + w - wDir
      let yd = yy + (altCab - altDir) / 2
      texto(`Orçamento ${d.numero}`, xd, yd, wDir, { tam: 15, negrito: true, alinhar: 'right' })
      yd += altTit
      for (const [t, e] of linhasDir) { texto(t, xd, yd, wDir, e); yd += altTexto(t, wDir, e) }
      texto(emissao, x, yy + altCab + 8, w, { tam: 8, negrito: true, cor: CINZA })
    }))
  }

  // ── 2) Dados do cliente ────────────────────────────────────────────────────
  {
    const linhas = [`${d.cliente.cidadeUf}   ·   Telefone: ${d.cliente.telefone}`]
    if (d.cliente.email) linhas.push(`E-mail: ${d.cliente.email}`)
    if (d.cliente.endereco || d.cliente.cep) {
      linhas.push([d.cliente.endereco ? `Endereço: ${d.cliente.endereco}` : '', d.cliente.cep ? `CEP: ${d.cliente.cep}` : ''].filter(Boolean).join('   ·   '))
    }
    const hs = linhas.map((t) => altTexto(t, W - 2 * PAD))
    colocar(caixa(ALT_TITULO + 6 + 13 + hs.reduce((a, b) => a + b, 0), (x, yy, w) => {
      titulo(x, yy, w, 'Dados do Cliente', 'Sistema instalado e homologado', true)
      segs([{ t: 'Cliente: ' }, { t: d.cliente.nome, negrito: true }], x, yy + ALT_TITULO + 6, w)
      let ly = yy + ALT_TITULO + 6 + 13
      linhas.forEach((t, i) => { texto(t, x, ly, w); ly += hs[i] })
    }))
  }

  // ── 3) Condição de pagamento ───────────────────────────────────────────────
  {
    const s: Seg[] = [{ t: 'Condição de Pagamento:  ', negrito: true }, { t: 'PIX (à vista, 5% de desconto), financiamento bancário ou cartão de crédito' }]
    colocar(caixa(altSegs(s, W - 2 * PAD), (x, yy, w) => segs(s, x, yy, w)))
  }

  // ── 4) Potência + estrutura ────────────────────────────────────────────────
  {
    const larg = [22, 72, 16, 28, 24].map((v) => v * MM)
    const t = tabela(larg, [
      ['Tipo estrutura', 'Detalhes da estrutura', 'Linhas', 'Módulos por linha', 'Orientação'],
      [d.estrutura.tipo, d.estrutura.detalhes, String(d.estrutura.linhas), String(d.estrutura.modulosPorLinha), d.estrutura.orientacao],
    ])
    colocar(caixa(ALT_TITULO + 6 + t.altura, (x, yy, w) => {
      titulo(x, yy, w, `Potência do sistema: ${num(d.kwp, 2)} kWp`, `Geração estimada: ~${num(d.geracaoMes)} kWh/mês (~${num(d.geracaoAno)} kWh/ano)`)
      t.desenhar(x, yy + ALT_TITULO + 6)
    }), 6)
  }

  // ── 5) Produtos (linha a linha, para poder quebrar página) ─────────────────
  {
    const wQ = 30 * MM, wP = W - wQ, ph = 10
    const cab: Bloco = {
      altura: 22,
      desenhar: (yy) => {
        doc.save().lineWidth(0.8).strokeColor(BORDA).moveTo(MARGEM_X, yy).lineTo(MARGEM_X + W, yy).stroke()
          .lineWidth(0.5).moveTo(MARGEM_X, yy + 22).lineTo(MARGEM_X + W, yy + 22).stroke()
          .lineWidth(0.8).moveTo(MARGEM_X, yy).lineTo(MARGEM_X, yy + 22).moveTo(MARGEM_X + W, yy).lineTo(MARGEM_X + W, yy + 22).stroke().restore()
        texto('Produto', MARGEM_X + ph, yy + 7, wP - 2 * ph, { tam: 8, negrito: true, cor: CINZA })
        texto('Quantidade', MARGEM_X + wP, yy + 7, wQ - ph, { tam: 8, negrito: true, cor: CINZA, alinhar: 'right' })
      },
    }
    colocar(cab, 0)
    d.produtos.forEach((p, i) => {
      const hn = altTexto(p.nome, wP - 2 * ph, { negrito: true })
      const hf = p.fabricante ? altTexto(`Fabricante: ${p.fabricante}`, wP - 2 * ph, { tam: 8 }) : 0
      const h = Math.max(hn + hf, 12) + 12
      const ultimo = i === d.produtos.length - 1
      colocar({
        altura: h,
        desenhar: (yy) => {
          doc.save().lineWidth(ultimo ? 0.8 : 0.5).strokeColor(BORDA).moveTo(MARGEM_X, yy + h).lineTo(MARGEM_X + W, yy + h).stroke()
            .lineWidth(0.8).moveTo(MARGEM_X, yy).lineTo(MARGEM_X, yy + h).moveTo(MARGEM_X + W, yy).lineTo(MARGEM_X + W, yy + h).stroke().restore()
          // linha que abre a tabela de novo depois de uma quebra de página
          if (Math.abs(yy - MARGEM_Y) < 0.5) doc.save().lineWidth(0.8).strokeColor(BORDA).moveTo(MARGEM_X, yy).lineTo(MARGEM_X + W, yy).stroke().restore()
          const ty = yy + (h - hn - hf) / 2
          texto(p.nome, MARGEM_X + ph, ty, wP - 2 * ph, { negrito: true, cor: PRODUTO })
          if (p.fabricante) segs([{ t: 'Fabricante: ', cor: CINZA }, { t: p.fabricante, negrito: true, cor: CINZA }], MARGEM_X + ph, ty + hn, wP - 2 * ph, 8)
          texto(p.qtde, MARGEM_X + wP, yy + (h - 12) / 2, wQ - ph, { tam: 10, negrito: true, cor: PRODUTO, alinhar: 'right' })
        },
      }, 0)
    })
    y += 6
  }

  // ── 6) Serviços inclusos ───────────────────────────────────────────────────
  {
    const s: Seg[] = [{ t: 'Serviços inclusos: ', negrito: true }, { t: 'projeto elétrico, instalação completa, homologação junto à concessionária e frete dos equipamentos até o local.' }]
    colocar(caixa(altSegs(s, W - 2 * PAD), (x, yy, w) => segs(s, x, yy, w)))
  }

  // ── 7) Totais ──────────────────────────────────────────────────────────────
  {
    const wEsq = (W - 2 * PAD) * 0.55
    const linhas: [string, string, string?][] = [
      ['+ Equipamentos, instalação e homologação:', brl(d.valorTotal)],
      ['+ Frete:', 'Incluso'],
      ['+ Projeto elétrico:', 'Incluso'],
      ['À vista no PIX (5% de desconto):', brl(d.valorPix), VERDE],
    ]
    const wl = 62 * MM, wv = wEsq - wl - 8
    const alts = linhas.map(([a]) => altTexto(a, wl, { negrito: true }) + 6)
    const altEsq = alts.reduce((s, h) => s + h, 0)
    const altDir = 12 + 4 + 26 + 6 + 13
    const alt = Math.max(altEsq, altDir)
    colocar(caixa(alt, (x, yy, w) => {
      let ly = yy + (alt - altEsq) / 2
      linhas.forEach(([a, b, cor], i) => {
        texto(a, x, ly + 3, wl, { negrito: true, cor })
        texto(b, x + wl + 8, ly + 3, wv, { negrito: true, cor })
        ly += alts[i]
      })
      doc.save().lineWidth(2).strokeColor(BORDA).moveTo(x + wEsq, yy - 4).lineTo(x + wEsq, yy + alt + 4).stroke().restore()
      const xd = x + wEsq + 10, wd = w - wEsq - 10
      let dy = yy + (alt - altDir) / 2
      texto('Valor total:', xd, dy, wd, { tam: 10, negrito: true, alinhar: 'center' }); dy += 16
      texto(brl(d.valorTotal), xd, dy, wd, { tam: 22, negrito: true, alinhar: 'center' }); dy += 32
      texto(`ou ${brl(d.valorPix)} à vista no PIX`, xd, dy, wd, { tam: 10.5, negrito: true, cor: VERDE, alinhar: 'center' })
    }))
  }

  // ── 8) Formas de pagamento ─────────────────────────────────────────────────
  {
    const fin = tabela([22 * MM, 34 * MM], [['Prazo', 'Parcela'], ...d.financiamento.map((f) => [`${f.prazo}x`, brl(f.parcela)] as Celula[])])
    const meio = Math.ceil(d.cartao.length / 2)
    const linhasCar: Celula[][] = [['Nº', 'Parcela', 'Nº', 'Parcela']]
    for (let i = 0; i < meio; i++) {
      const a = d.cartao[i], b = d.cartao[i + meio]
      const celA: Celula = a.semJuros ? { t: '', segs: [{ t: brl(a.parcela) + ' ' }, { t: 's/ juros', negrito: true, cor: VERDE }] } : brl(a.parcela)
      linhasCar.push([`${a.n}x`, celA, b ? `${b.n}x` : '', b ? brl(b.parcela) : ''])
    }
    const car = tabela([16 * MM, 34 * MM, 16 * MM, 30 * MM], linhasCar)
    const sub = 12 + 11 + 4
    const alt = ALT_TITULO + 8 + sub + Math.max(fin.altura, car.altura)
    colocar(caixa(alt, (x, yy, w) => {
      titulo(x, yy, w, 'Formas de Pagamento')
      const y0 = yy + ALT_TITULO + 8
      texto('Financiamento bancário', x, y0, 62 * MM, { negrito: true })
      texto('1ª parcela só daqui a 120 dias', x, y0 + 12, 62 * MM, { tam: 8, cor: CINZA })
      fin.desenhar(x, y0 + sub)
      const xc = x + 62 * MM + 8
      texto('Cartão de crédito', xc, y0, w - 62 * MM, { negrito: true })
      texto('Até 3x sem juros', xc, y0 + 12, w - 62 * MM, { tam: 8, cor: CINZA })
      car.desenhar(xc, y0 + sub)
    }))
  }

  // ── 9) Sua economia (só com consumo) ───────────────────────────────────────
  if (d.economia) {
    const e = d.economia
    const wc = (W - 2 * PAD) / 5
    const rot = ['Conta de luz hoje', 'Economia por mês', 'Economia por ano', 'Retorno do investimento', 'Economia em 30 anos']
    const val = [brl(e.contaHoje), `~${brl(e.mes)}`, `~${brl(e.ano)}`, `~${num(e.retornoAnos, 1)} anos`, `~${brl(e.trintaAnos)}`]
    const hr = Math.max(...rot.map((r) => altTexto(r, wc - 10, { tam: 8 })))
    const nota = `Estimativa com base no consumo informado (${num(e.consumoKwh)} kWh/mês). Sempre continua a taxa mínima da concessionária (custo de disponibilidade) e a iluminação pública.`
    const hNota = altTexto(nota, W - 2 * PAD, { tam: 8 })
    const hGrade = hr + 8 + 14 + 10
    colocar(caixa(ALT_TITULO + 8 + hGrade + 6 + hNota, (x, yy, w) => {
      titulo(x, yy, w, 'Sua Economia')
      const y0 = yy + ALT_TITULO + 8
      doc.save().lineWidth(0.5).rect(x, y0, w, hGrade).fillAndStroke(FUNDO, BORDA).restore()
      rot.forEach((r, i) => {
        texto(r, x + i * wc + 5, y0 + 5 + (hr - altTexto(r, wc - 10, { tam: 8 })), wc - 10, { tam: 8, cor: CINZA, alinhar: 'center' })
        texto(val[i], x + i * wc + 5, y0 + 5 + hr + 5, wc - 10, { negrito: true, alinhar: 'center' })
      })
      texto(nota, x, y0 + hGrade + 6, w, { tam: 8, cor: CINZA })
    }))
  }

  // ── 10) Garantias, prazo e validade ────────────────────────────────────────
  {
    const gar = tabela([62 * MM, 22 * MM], [
      ['Garantia', 'Prazo'],
      ['Painéis solares (produção mínima de 80% em 30 anos)', '30 anos'],
      ['Inversor', '10 anos'],
      ['Estrutura de fixação', '25 anos'],
      ['Mão de obra (instalação)', '2 anos'],
    ])
    const wExe = W - 2 * PAD - 88 * MM
    const exe = tabela([wExe * 0.6, wExe * 0.4], [
      ['Etapa', 'Prazo estimado'],
      ['Entrega dos equipamentos', '~20 dias (com estoque)'],
      ['Instalação', '~5 dias úteis após a entrega'],
      ['Homologação na concessionária (projeto, vistoria e troca do medidor)', 'algumas semanas'],
      [{ t: 'Total, do fechamento à energia gerando', negrito: true }, { t: 'até 60 dias', negrito: true }],
    ])
    const val: Seg[] = [{ t: 'Validade da proposta: 3 dias', negrito: true, cor: VALIDADE }, { t: ` (até ${d.validaAte}) — os preços dos equipamentos dependem do estoque do fornecedor.`, cor: VALIDADE }]
    const hVal = altSegs(val, W - 2 * PAD)
    const hTab = 14 + Math.max(gar.altura, exe.altura)
    colocar(caixa(ALT_TITULO + 8 + hTab + 8 + hVal + 4 + 11, (x, yy, w) => {
      titulo(x, yy, w, 'Garantias, Prazo e Validade')
      const y0 = yy + ALT_TITULO + 8
      texto('Garantias', x, y0, 88 * MM, { negrito: true })
      gar.desenhar(x, y0 + 14)
      texto('Prazo de execução', x + 88 * MM, y0, wExe, { negrito: true })
      exe.desenhar(x + 88 * MM, y0 + 14)
      const yv = y0 + hTab + 8
      segs(val, x, yv, w)
      texto('Aplicativo de monitoramento da geração incluso.', x, yv + hVal + 4, w, { tam: 8, cor: CINZA })
    }))
  }

  // ── 11) Observações ────────────────────────────────────────────────────────
  {
    const itens = d.observacoes.map((t, i) => `${i + 1}. ${t}`)
    const hs = itens.map((t) => altTexto(t, W - 2 * PAD, { tam: 8 }))
    colocar(caixa(13 + hs.reduce((a, b) => a + b, 0), (x, yy, w) => {
      texto('Observações:', x, yy, w, { negrito: true })
      let oy = yy + 13
      itens.forEach((t, i) => { texto(t, x, oy, w, { tam: 8, cor: CINZA }); oy += hs[i] })
    }))
  }

  doc.end()
  return fim
}
