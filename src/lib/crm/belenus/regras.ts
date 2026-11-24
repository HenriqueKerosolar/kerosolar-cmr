// 🤖 Cotação automática na Belenus (Gerador Personalizado) — parte PURA (testável, sem rede e sem banco).
// Fase 1 (24/11/2026): SÓ LEITURA. O robô monta o kit pelas rotas de consulta do catálogo e devolve as peças;
// nada é enviado ao cliente e NENHUMA rota de carrinho/pedido/pagamento pode ser chamada (ver rotaPermitida).
// Regras de montagem do dono: memória "regras-negocio-kerosolar.md", seção "Dimensionamento e preço do kit
// pela Belenus" (24/11/2026).

// ── Comando do operador ──────────────────────────────────────────────────────
//   "cota belenus 4,34 kWp" · "cota belenus 4.34kwp" · "cota belenus 4,34" → potência informada
//   "cota belenus"                                                     → usa o consumo do lead → kWp
export type ComandoBelenus = { kwp: number | null; micro?: boolean } | { erro: string }

export function lerComandoBelenus(text: string): ComandoBelenus | null {
  const t = (text || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const m = /^cot[ae]r?\s+(?:na\s+)?belenus\b\s*(.*)$/.exec(t)
  if (!m) return null
  // 24/11/2026: 'micro' no comando → micro inversor Deye (1 para cada 4 placas)
  const micro = /\bmicro/.test(m[1])
  const resto = m[1].replace(/[.!]+$/, '').replace(/\bmicro\s*(?:inversor(?:es)?)?\b/g, '').replace(/\s+/g, ' ').trim()
  if (!resto) return { kwp: null, ...(micro ? { micro } : {}) }
  const v = /^(?:de\s+|com\s+|para\s+|pra\s+)?(\d+(?:[.,]\d+)?)\s*(?:kwp|kw)?$/.exec(resto)
  if (!v) return { erro: 'Não entendi a potência: escreva "cota belenus 4,34 kWp" (ou só "cota belenus" para usar o consumo do lead). Nada foi enviado ao cliente.' }
  const kwp = parseFloat(v[1].replace(',', '.'))
  if (!(kwp > 0) || kwp > 300) return { erro: 'A potência precisa ser maior que zero (em kWp, ex.: "cota belenus 4,34 kWp"). Nada foi enviado ao cliente.' }
  return { kwp: Math.round(kwp * 100) / 100, ...(micro ? { micro } : {}) }
}

// ── Consumo do lead → kWp (quando o operador escreve só "cota belenus") ─────────
// Regra do dono: 1 painel = 60 kWh/mês (agent.ts/engine.ts). Painel de referência = 620 W (o da cotação de
// exemplo WEB-007268278: 7 × 620 W = 4,34 kWp para ~420 kWh). É uma ESTIMATIVA — a nota avisa.
export const KWH_POR_PAINEL = 60
export const PAINEL_REFERENCIA_KW = 0.62
export function kwpPorConsumo(kwhMes: number): number {
  if (!(kwhMes > 0)) return 0
  const paineis = Math.ceil(kwhMes / KWH_POR_PAINEL)
  return Math.round(paineis * PAINEL_REFERENCIA_KW * 100) / 100
}

// ── Dados do lead ────────────────────────────────────────────────────────────
export type Ligacao = 'monofásico' | 'bifásico' | 'trifásico'

function semAcento(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function lerLigacao(medidor: unknown): Ligacao | null {
  const t = semAcento(medidor)
  const achados: Ligacao[] = []
  if (/mono/.test(t)) achados.push('monofásico')
  if (/\bbi|bifas/.test(t)) achados.push('bifásico')
  if (/tri/.test(t)) achados.push('trifásico')
  return achados.length === 1 ? achados[0] : null
}

export function lerTensao(tensao: unknown): number | null {
  const m = /(127|220|380|440)/.exec(String(tensao ?? ''))
  return m ? Number(m[1]) : null
}

export type Telhado = 'colonial' | 'fibrocimento' | 'metálico' | 'laje' | 'solo'
export function lerTelhado(telhado: unknown): Telhado | null {
  const t = semAcento(telhado)
  if (!t) return null
  if (/colonial|ceramic|barro|telha romana|portuguesa|americana/.test(t)) return 'colonial'
  if (/fibro|eternit|amianto|ondulad/.test(t)) return 'fibrocimento'
  if (/metal|zinco|galvalume|trapez|sanduiche/.test(t)) return 'metálico'
  if (/laje|concreto/.test(t)) return 'laje'
  if (/solo|chao/.test(t)) return 'solo'
  return null
}

/** Palavras que identificam o tipo de telhado nas estruturas da Belenus (grupo / subgrupo / tipo). */
export const PALAVRAS_TELHADO: Record<Telhado, RegExp> = {
  colonial: /colonial|ceramic/,
  fibrocimento: /fibrocimento|fibro|eternit|ondulad/,
  'metálico': /metalic|trapez|zinco|ondulad.*metal|perfil/,
  laje: /laje/,
  solo: /solo/,
}

// ── Leitura tolerante das respostas ──────────────────────────────────────────
export type Obj = Record<string, unknown>
export const ehObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const s = v.trim()
    const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/** Primeiro campo presente (e não vazio) entre os nomes dados. */
export function campo(o: unknown, ...nomes: string[]): unknown {
  if (!ehObj(o)) return undefined
  for (const n of nomes) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n]
  return undefined
}

/** `data.<chave>` da resposta da Belenus ({ isSucceed, data, messages }) como lista (ou [] se não vier). */
export function listaDe(resp: unknown, ...chaves: string[]): Obj[] {
  const data = ehObj(resp) && 'data' in resp ? resp.data : resp
  if (Array.isArray(data)) return data.filter(ehObj)
  for (const c of chaves) {
    const v = ehObj(data) ? data[c] : undefined
    if (Array.isArray(v)) return v.filter(ehObj)
  }
  return []
}

/** Mensagens de erro da Belenus ({ messages: [{ description }] }), em texto. */
export function mensagensBelenus(resp: unknown): string {
  const ms = ehObj(resp) && Array.isArray(resp.messages) ? resp.messages : []
  return ms.map((m) => (ehObj(m) ? String(m.description ?? m.message ?? '') : String(m))).filter(Boolean).join(' / ')
}

export const descricaoDe = (o: unknown) => String(campo(o, 'descricaoItem', 'descricao', 'descricaoProduto', 'nome', 'modelo') ?? '').trim()
export const codigoDe = (o: unknown) => String(campo(o, 'item', 'sku', 'codigo') ?? '').trim()
export const qtdeDe = (o: unknown) => {
  const n = num(campo(o, 'qtde', 'quantidade', 'numeroModulos', 'numInversores'))
  return Number.isFinite(n) ? n : 0
}
/** Preço unitário, se a API mandar (nas etapas de consulta normalmente NÃO manda — só o carrinho tem preço). */
export const precoDe = (o: unknown) => {
  const n = num(campo(o, 'valorUnitario', 'precoUnitario', 'preco', 'valor', 'valorVenda', 'precoVenda'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Potência em W (a Belenus pode mandar 620 ou 0,62). */
export function potenciaW(v: unknown): number {
  const n = num(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 10 ? Math.round(n * 1000) : n
}
/** Potência em kW (aceita 3000 W ou 3 kW). */
export function potenciaKw(v: unknown): number {
  const n = num(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 100 ? n / 1000 : n
}

// ── Módulo: primeiro da lista na faixa de 600 W ──────────────────────────────
// Ordem padrão do Gerador Personalizado = "Menor preço" (ordenacao=1): por `index` crescente; empate → maior
// potência (bundle: filtroModulos, caso MenorPreco). Se não vier `index`, mantém a ordem da API.
export function ordenarComoSite(modulos: Obj[]): Obj[] {
  return modulos.map((m, i) => ({ m, i })).sort((a, b) => {
    const ia = num(a.m.index), ib = num(b.m.index)
    if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib
    const pa = potenciaW(a.m.potencia), pb = potenciaW(b.m.potencia)
    if (pa !== pb && Number.isFinite(ia) && Number.isFinite(ib)) return pb - pa
    return a.i - b.i
  }).map((x) => x.m)
}

export function escolherModulo600(modulos: Obj[]): Obj | null {
  return ordenarComoSite(modulos).find((m) => {
    const w = potenciaW(campo(m, 'potencia', 'potenciaModulo'))
    return w >= 600 && w < 700
  }) ?? null
}

// ── Inversor ─────────────────────────────────────────────────────────────────
export const MARCA_PREFERIDA = 'AUXSOL'
export const LIMITE_MONOFASICO_KW = 5
/** Medidor monofásico 220 V: inversor monofásico 220 V até 10 kW (dono, 24/11/2026). 127 V (o "110 V"): até 5 kW. */
export const LIMITE_MONOFASICO_220_KW = 10
/** Micro inversor (quando o cliente pede): DEYE, 1 micro para cada 4 placas (dono, 24/11/2026). */
export const PLACAS_POR_MICRO = 4
export const TRANSFORMADOR_PRECO = 600

/** Opção de um filtro da Belenus ({ tipoLigacao: "..." } ou string) → texto. */
export function opcaoTexto(o: unknown, chave: string): string {
  if (typeof o === 'string') return o
  return String(campo(o, chave, 'descricao', 'nome', 'valor') ?? '')
}

/** Escolhe a opção de filtro que casa com o padrão (e não casa com o "evitar"). */
export function escolherOpcao(lista: unknown[], chave: string, quer: RegExp, evitar?: RegExp): string | null {
  const textos = lista.map((o) => opcaoTexto(o, chave)).filter(Boolean)
  return textos.find((t) => quer.test(semAcento(t)) && !(evitar && evitar.test(semAcento(t)))) ?? null
}

export const RE_ON_GRID = /on.?grid|string|grid.?tie|convencional/
export const RE_NAO_ON_GRID = /hibrid|off.?grid|micro|bateria/
export function reLigacao(l: Ligacao): RegExp {
  // medidor bifásico (2 fases, 220 V) usa inversor monofásico 220 V
  return l === 'trifásico' ? /trif/ : /monof/
}
export function reTensao(v: number): RegExp {
  return new RegExp(`\\b${v}\\b`)
}

export function ehMarca(inv: unknown, marca: string): boolean {
  return semAcento(campo(inv, 'fabricante', 'marca', 'descricaoItem', 'descricao')).includes(marca.toLowerCase())
}

export function ehMarcaPreferida(inv: unknown): boolean {
  return semAcento(campo(inv, 'fabricante', 'marca', 'descricaoItem', 'descricao')).includes(MARCA_PREFERIDA.toLowerCase())
}

export type EscolhaInversor = { inversor: Obj; qtdeSugeridaBelenus: number } | { motivo: 'mais-de-um' | 'acima-limite' | 'nenhum' | 'fora-da-faixa' }

/**
 * Regras do dono: preferência AUXSOL; usar UM inversor (se a Belenus sugerir mais de 1 → passar para 1 trifásico);
 * medidor monofásico → inversor de no máximo 5 kW.
 */
/** Overload máximo aceito (painéis acima da potência do inversor): 30% — regra técnica do prompt da IA (10%–30%). */
export const OVERLOAD_MAX = 1.3
/** AUXSOL aceita 100% de overload, mas o dono usa 50% (24/11/2026): kit até 1,5× a potência do inversor. */
export const OVERLOAD_AUXSOL = 1.5
/** Só no MONOFÁSICO (inversor limitado a 5 kW): AUXSOL pode ir até 85% de overload (dono, 24/11/2026). */
export const OVERLOAD_MONOFASICO_LIMITE = 1.85

/** Micro inversor (dono, 24/11/2026): DEYE, o modelo de 4 entradas (o de maior potência da lista de micros da Deye). */
export function escolherMicro(inversores: Obj[]): EscolhaInversor {
  const kw = (i: Obj) => potenciaKw(campo(i, 'potenciaNominalSaida', 'potencia', 'maxPotenciaSaida'))
  const micros = inversores.filter((i) => /micro/i.test(String(campo(i, 'descricaoItem', 'descricao', 'tipoInversor') ?? '')))
  const deye = micros.filter((i) => ehMarca(i, 'DEYE'))
  const lista = (deye.length ? deye : micros).sort((a, b) => (kw(b) || 0) - (kw(a) || 0))
  return lista[0] ? { inversor: lista[0], qtdeSugeridaBelenus: 1 } : { motivo: 'nenhum' }
}

export function escolherInversor(inversores: Obj[], opts: { limiteKw?: number; kwpKit?: number; somenteFaixa?: boolean } = {}): EscolhaInversor {
  if (!inversores.length) return { motivo: 'nenhum' }
  const ordenados = ordenarComoSite(inversores)
  const kw = (i: Obj) => potenciaKw(campo(i, 'potenciaNominalSaida', 'potencia', 'maxPotenciaSaida'))
  const dentroLimite = (i: Obj) => !opts.limiteKw || kw(i) <= opts.limiteKw + 1e-9
  const qtdSug = (i: Obj) => {
    const q = num(campo(i, 'numInversores', 'qtdSugerida', 'qtde', 'quantidade'))
    return Number.isFinite(q) && q > 0 ? q : 1
  }
  // 24/11/2026 (teste real 8,68 kWp): a ordem do site pôs o Auxsol de 15 kW na frente — grande demais. O inversor
  // certo é o MENOR que atende o kit (potência × 1,3 ≥ kWp do kit), preferindo AUXSOL.
  // Regra do dono (24/11/2026): o inversor fica UM POUCO ABAIXO da potência das placas, respeitando o overload
  // (até 30%): kWp/1,3 ≤ inversor ≤ kWp → o MAIOR dessa faixa, AUXSOL primeiro. Se nada cair na faixa, o menor acima.
  // AUXSOL aceita 100% de overload (placas até 2× o inversor) — dono, 24/11/2026; outras marcas, 30%.
  // Dono (24/11/2026): 50% de overload vale para TODAS as marcas (sem Auxsol, outra marca na mesma faixa).
  const overload = (_i: Obj) => OVERLOAD_AUXSOL
  const naFaixa = (i: Obj) => !!opts.kwpKit && Number.isFinite(kw(i)) && kw(i) <= opts.kwpKit + 1e-9 && kw(i) * overload(i) + 1e-9 >= opts.kwpKit
  const atende = (i: Obj) => !opts.kwpKit || !Number.isFinite(kw(i)) || kw(i) * OVERLOAD_MAX + 1e-9 >= opts.kwpKit
  const porTamanho = (lista: Obj[]) => [...lista].sort((a, b) => (kw(a) || 1e9) - (kw(b) || 1e9))
  const base = ordenados.filter((i) => qtdSug(i) <= 1 && dentroLimite(i))
  const faixa = base.filter(naFaixa)
  // Dono (24/11/2026): o MENOR inversor da faixa (potência × overload ≥ kWp do kit), AUXSOL primeiro.
  // Ex.: 8 kWp → 6 kW (6 × 1,5 = 9); 4,34 kWp → 3 kW (3 × 1,5 = 4,5) — bate com a cotação do dono.
  // marca: AUXSOL → DEYE → SOLIS → qualquer outra (dono, 24/11/2026), sempre o menor da faixa
  const escolhidoFaixa = porTamanho(faixa.filter(ehMarcaPreferida))[0] ?? porTamanho(faixa.filter((i) => ehMarca(i, 'DEYE')))[0]
    ?? porTamanho(faixa.filter((i) => ehMarca(i, 'SOLIS')))[0] ?? porTamanho(faixa)[0]
  if (escolhidoFaixa) return { inversor: escolhidoFaixa, qtdeSugeridaBelenus: qtdSug(escolhidoFaixa) }
  // Regra do dono (24/11/2026): MONOFÁSICO (limite 5 kW) é a ÚNICA situação em que o inversor AUXSOL pode ir até
  // 85% de overload — o maior inversor dentro do limite cobre kits até 5 × 1,85 = 9,25 kWp. Acima disso: transformador.
  if (opts.limiteKw && opts.limiteKw <= LIMITE_MONOFASICO_KW && opts.kwpKit) {
    const ate85 = base.filter((i) => Number.isFinite(kw(i)) && kw(i) * OVERLOAD_MONOFASICO_LIMITE + 1e-9 >= opts.kwpKit!)
    const maior = porTamanho(ate85.filter(ehMarcaPreferida)).pop() ?? porTamanho(ate85.filter((i) => ehMarca(i, 'DEYE'))).pop() ?? porTamanho(ate85.filter((i) => ehMarca(i, 'SOLIS'))).pop() ?? porTamanho(ate85).pop()
    if (maior) return { inversor: maior, qtdeSugeridaBelenus: qtdSug(maior) }
    return { motivo: 'acima-limite' }
  }
  if (opts.somenteFaixa) return { motivo: 'fora-da-faixa' }
  const candidatos = base.filter(atende)
  const melhor = porTamanho(candidatos.filter(ehMarcaPreferida))[0] ?? porTamanho(candidatos)[0]
  if (melhor) return { inversor: melhor, qtdeSugeridaBelenus: qtdSug(melhor) }
  const preferidos = [...ordenados.filter(ehMarcaPreferida), ...ordenados.filter((i) => !ehMarcaPreferida(i))]
  const umSo = preferidos.filter((i) => qtdSug(i) <= 1)
  const ok = umSo.find(dentroLimite)
  if (ok) return { inversor: ok, qtdeSugeridaBelenus: qtdSug(ok) }
  if (umSo.length) return { motivo: 'acima-limite' }
  return { motivo: 'mais-de-um' }
}

// ── Strings, cabos e DPS (regra do dono) ─────────────────────────────────────
export const PAINEIS_POR_STRING = 8
export const METROS_CABO_POR_STRING = 25
export const BITOLA_CABO_MM = 6

export function calcularStrings(qtdModulos: number): number {
  return qtdModulos > 0 ? Math.ceil(qtdModulos / PAINEIS_POR_STRING) : 0
}

export type Cabos = { preto: number; vermelho: number; verde: number }
export function calcularCabos(strings: number): Cabos {
  const preto = strings * METROS_CABO_POR_STRING
  const vermelho = strings * METROS_CABO_POR_STRING
  const verde = strings <= 1 ? METROS_CABO_POR_STRING : Math.ceil(vermelho / 2)
  return { preto, vermelho, verde }
}

export function calcularDps(ligacao: Ligacao): number {
  return ligacao === 'trifásico' ? 3 : 2
}

export type CorCabo = 'preto' | 'vermelho' | 'verde'
export function corDoCabo(desc: string): CorCabo | null {
  const t = semAcento(desc)
  if (!/\bcabo/.test(t)) return null
  if (/\bpreto|\bpt\b|negro/.test(t)) return 'preto'
  if (/vermelh|\bvm\b|\bvml?\b/.test(t)) return 'vermelho'
  if (/\bverde|amarel|terra/.test(t)) return 'verde'
  return null
}
export function bitolaMm(desc: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*mm/.exec(semAcento(desc))
  return m ? parseFloat(m[1].replace(',', '.')) : null
}
export const ehDps = (desc: string) => /\bdps\b|protetor de surto|supressor/.test(semAcento(desc))

export type Peca = { codigo: string; descricao: string; qtde: number; preco: number | null; ajuste?: string }

export function paraPeca(o: Obj): Peca {
  return { codigo: codigoDe(o), descricao: descricaoDe(o), qtde: qtdeDe(o), preco: precoDe(o) }
}

/** Junta itens repetidos (a Belenus manda o mesmo item mais de uma vez; o site também tira repetidos). */
export function semRepetidos(itens: Obj[]): Obj[] {
  const vistos = new Set<string>()
  return itens.filter((i) => {
    const c = codigoDe(i)
    if (!c) return true
    if (vistos.has(c)) return false
    vistos.add(c)
    return true
  })
}

/**
 * Aplica as regras de cabo e DPS do dono sobre os componentes sugeridos pela Belenus.
 * - cabos preto/vermelho: 6 mm, 25 m por string (troca a bitola se a Belenus sugerir outra, usando um item de
 *   6 mm da lista completa quando existir);
 * - cabo verde: 25 m com 1 string; com mais strings, metade do vermelho;
 * - DPS: 2 (mono/bifásico) ou 3 (trifásico) — aplicado no primeiro DPS da lista.
 * Devolve a lista ajustada + o que mudou (para a nota).
 */
export function aplicarRegrasComponentes(
  sugeridos: Peca[], todos: Peca[], strings: number, ligacao: Ligacao, opts: { aplicarDps?: boolean; aplicarCabos?: boolean } = {},
): { pecas: Peca[]; ajustes: string[] } {
  const alvo = calcularCabos(strings)
  const ajustes: string[] = []
  let pecas = sugeridos.map((p) => ({ ...p }))

  for (const cor of opts.aplicarCabos === false ? [] : (['preto', 'vermelho', 'verde'] as const)) {
    // 24/11/2026: verde também em 6 mm (o robô pegou 4 mm; a cotação do dono usa 6 mm no verde)
    const querMm = BITOLA_CABO_MM
    const daCor = pecas.filter((p) => corDoCabo(p.descricao) === cor)
    let certo = daCor.find((p) => querMm == null || bitolaMm(p.descricao) === querMm)
    if (!certo) {
      const daLista = todos.find((p) => corDoCabo(p.descricao) === cor && (querMm == null || bitolaMm(p.descricao) === querMm))
      if (daLista) {
        certo = { ...daLista, qtde: 0 }
        pecas.push(certo)
      }
    }
    if (!certo) {
      if (daCor.length) {
        // não achou 6 mm em lugar nenhum: mantém o item da Belenus, só ajusta a quantidade
        certo = daCor[0]
        ajustes.push(`Cabo ${cor}: não achei ${querMm} mm no catálogo; mantive "${certo.descricao}" (CONFERIR bitola).`)
      } else {
        ajustes.push(`Cabo ${cor}: a Belenus não sugeriu e não achei no catálogo — incluir ${alvo[cor]} m manualmente.`)
        continue
      }
    }
    // remove os outros cabos da mesma cor (bitola errada)
    for (const outro of daCor) {
      if (outro === certo) continue
      ajustes.push(`Cabo ${cor}: removido "${outro.descricao}" (${outro.qtde}) — regra do dono é ${querMm} mm.`)
      pecas = pecas.filter((p) => p !== outro)
    }
    if (certo.qtde !== alvo[cor]) {
      ajustes.push(`Cabo ${cor}: ${certo.qtde || 0} → ${alvo[cor]} m (regra do dono: ${strings} string(s)).`)
      certo.ajuste = `regra do dono (Belenus: ${certo.qtde || 0})`
      certo.qtde = alvo[cor]
    }
  }

  if (opts.aplicarDps !== false) {
    const dps = pecas.find((p) => ehDps(p.descricao))
    const querDps = calcularDps(ligacao)
    if (dps && dps.qtde !== querDps) {
      ajustes.push(`DPS: ${dps.qtde} → ${querDps} (regra do dono: ${ligacao === 'trifásico' ? 'trifásico' : 'mono/bifásico'}).`)
      dps.ajuste = `regra do dono (Belenus: ${dps.qtde})`
      dps.qtde = querDps
    }
  }
  return { pecas, ajustes }
}

// ── Rotas: o robô só CONSULTA o catálogo (nunca compra, nunca gera pedido) ────
export const BELENUS_BASE = 'https://belenus.com.br/'
export const ROTA_LOGIN = 'api/autenticacao/Usuario/Login/PessoaJuridicaByEmail'
export const ROTAS_PERMITIDAS: readonly string[] = [
  ROTA_LOGIN,
  'api/catalogo/KitPersonalizado/Modulos',
  'api/catalogo/KitPersonalizado/InversorFiltro',
  'api/catalogo/KitPersonalizado/Inversor',
  'api/catalogo/KitPersonalizado/TodosInversores',
  'api/catalogo/KitPersonalizado/ConferirPotenciaInversor',
  'api/catalogo/KitPersonalizado/TipoEstrutura',
  'api/catalogo/KitPersonalizado/Estrutura',
  'api/catalogo/KitPersonalizado/Outros',
  'api/catalogo/KitPersonalizado/OutrosAC',
]
/** Nunca: carrinho, pedido, pagamento, seguro, frete, cupom, upload (o dono proibiu — Fase 1 é só leitura). */
export const ROTA_PROIBIDA = /api\/(carrinho|pedido|pagamento|planopagamento|fretes?)\/|ConfirmarCarrinho|EnviarHistoricoPedido|AlterarConfirmar|AlterarCarrinho|SalvarOrcamentoCliente|\/Confirmar\b|IncluirSeguro|AdicionarFrete|Cupom|Upload/i

/** true só para as rotas de consulta da lista (+ StringBox/{site}). Qualquer outra → false. */
export function rotaPermitida(url: string): boolean {
  let caminho = url
  if (url.startsWith(BELENUS_BASE)) caminho = url.slice(BELENUS_BASE.length)
  else if (/^https?:\/\//i.test(url)) return false
  caminho = caminho.split('?')[0].replace(/^\/+/, '')
  if (ROTA_PROIBIDA.test(caminho)) return false
  if (/^api\/catalogo\/KitPersonalizado\/StringBox\/\d+$/.test(caminho)) return true
  return ROTAS_PERMITIDAS.includes(caminho)
}

// ── "Forma" da resposta para o log (sem valores sensíveis) ────────────────────
const CAMPOS_AMOSTRA = ['item', 'sku', 'descricaoItem', 'descricao', 'fabricante', 'potencia', 'potenciaNominalSaida', 'tipoLigacao', 'tensaoSaida', 'qtde', 'quantidade', 'numeroModulos', 'numInversores', 'index', 'valorUnitario', 'preco', 'valor', 'valorTotal']
const SENSIVEL = /token|senha|password|email|cpf|cnpj|documento|telefone|celular|nome|endereco|logradouro|cep/i

/** Descreve tipos e tamanhos (nunca valores, exceto amostra de até 2 itens com campos de produto). */
export function formaResposta(v: unknown, prof = 0): unknown {
  if (Array.isArray(v)) {
    const amostra = v.slice(0, 2).map((x) => (ehObj(x)
      ? Object.fromEntries(CAMPOS_AMOSTRA.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]))
      : typeof x))
    return { lista: v.length, chavesDoItem: ehObj(v[0]) ? Object.keys(v[0]) : typeof v[0], amostra }
  }
  if (ehObj(v)) {
    if (prof > 3) return 'objeto'
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSIVEL.test(k) ? `(${typeof x})` : formaResposta(x, prof + 1)]))
  }
  if (typeof v === 'string') return 'string'
  return typeof v
}

// ── Resultado ────────────────────────────────────────────────────────────────
export type ResultadoCotacao = {
  potenciaPedidaKwp: number
  modulo: Peca & { potenciaW: number; potenciaKitKwp: number | null }
  inversor: Peca & { potenciaKw: number; ligacao: string; tensao: string }
  estrutura: Peca[]
  componentesCC: Peca[]
  componentesCA: Peca[]
  strings: number
  avisos: string[]
  ajustes: string[]
  totalProdutos: number | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function linhaPeca(p: Peca): string {
  const preco = p.preco != null ? ` — ${brl(p.preco)}/un` : ''
  const aj = p.ajuste ? ` [${p.ajuste}]` : ''
  return `• ${p.qtde} × ${p.descricao || '(sem descrição)'} (cód. ${p.codigo || '?'})${preco}${aj}`
}

/** Soma preço × quantidade se TODAS as peças tiverem preço; senão null. */
export function totalSeTiverPreco(pecas: Peca[]): number | null {
  if (!pecas.length || pecas.some((p) => p.preco == null)) return null
  return Math.round(pecas.reduce((s, p) => s + (p.preco ?? 0) * p.qtde, 0) * 100) / 100
}

export function textoNota(r: ResultadoCotacao): string {
  const l: string[] = []
  l.push(`🤖 Cotação Belenus (Fase 1, só leitura — nada foi enviado ao cliente nem ao carrinho) para ${r.potenciaPedidaKwp.toLocaleString('pt-BR')} kWp`)
  l.push('')
  l.push(`MÓDULO: ${r.modulo.qtde} × ${r.modulo.descricao} (cód. ${r.modulo.codigo}, ${r.modulo.potenciaW} W)` +
    (r.modulo.potenciaKitKwp ? ` → ${r.modulo.potenciaKitKwp.toLocaleString('pt-BR')} kWp` : '') +
    (r.modulo.preco != null ? ` — ${brl(r.modulo.preco)}/un` : ''))
  l.push(`INVERSOR: ${r.inversor.qtde} × ${r.inversor.descricao} (cód. ${r.inversor.codigo}, ${r.inversor.potenciaKw.toLocaleString('pt-BR')} kW, ${r.inversor.ligacao} ${r.inversor.tensao})` +
    (r.inversor.preco != null ? ` — ${brl(r.inversor.preco)}/un` : ''))
  l.push(`STRINGS: ${r.strings} (8 painéis por string)`)
  l.push('', 'ESTRUTURA:', ...(r.estrutura.length ? r.estrutura.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('', 'COMPONENTES CC:', ...(r.componentesCC.length ? r.componentesCC.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('', 'COMPONENTES CA:', ...(r.componentesCA.length ? r.componentesCA.map(linhaPeca) : ['• (nenhum item devolvido)']))
  l.push('')
  l.push(r.totalProdutos != null
    ? `TOTAL DOS PRODUTOS (pela API): ${brl(r.totalProdutos)} — sem frete/seguro.`
    : 'PREÇO/TOTAL: a Belenus só calcula o total ao criar o carrinho (rota Confirmar), que o robô NÃO chama na Fase 1.')
  if (r.ajustes.length) l.push('', 'AJUSTES PELA REGRA DO DONO:', ...r.ajustes.map((a) => `• ${a}`))
  if (r.avisos.length) l.push('', 'AVISOS:', ...r.avisos.map((a) => `⚠️ ${a}`))
  return l.join('\n')
}
