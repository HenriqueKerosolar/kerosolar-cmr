import 'server-only'
// 🤖 Orquestra a cotação na Belenus (Fase 1 — SÓ LEITURA), na mesma ordem do "Gerador Personalizado":
//   login → Módulos → filtros do inversor → Inversor → ConferirPotenciaInversor → TipoEstrutura → Estrutura
//   → Outros (CC) → OutrosAC (CA)
// e PARA aí: o próximo passo do site é api/carrinho/KitPersonalizado/Confirmar (cria o carrinho e é onde
// aparecem preço/frete/total) — PROIBIDO nesta fase.
// Disparo: comando do operador "cota belenus <kWp>" na conversa do lead (ver comandoCotaBelenus).

import { ErroBelenus, chamarBelenus, loginBelenus, siteBelenus, type SessaoBelenus } from './api'
import {
  LIMITE_MONOFASICO_KW, MARCA_PREFERIDA, PALAVRAS_TELHADO, RE_NAO_ON_GRID, RE_ON_GRID, TRANSFORMADOR_PRECO,
  aplicarRegrasComponentes, calcularStrings, campo, descricaoDe, ehDps, ehMarcaPreferida, ehObj, escolherInversor,
  escolherModulo600, escolherOpcao, kwpPorConsumo, lerComandoBelenus, lerLigacao, lerTelhado, lerTensao, listaDe, num,
  opcaoTexto, paraPeca, potenciaKw, potenciaW, qtdeDe, reLigacao, reTensao, semRepetidos, textoNota,
  totalSeTiverPreco, type Ligacao, type Obj, type ResultadoCotacao, type Telhado,
} from './regras'

export type EntradaCotacao = {
  kwp: number
  ligacao?: Ligacao | null   // medidor do lead
  tensao?: number | null     // V (do lead)
  telhado?: Telhado | null   // do lead
}

const P = 'api/catalogo/KitPersonalizado/'

// ── trava: no máximo 1 cotação por vez ───────────────────────────────────────
let emAndamento = false

export async function montarKitBelenus(entrada: EntradaCotacao): Promise<ResultadoCotacao> {
  if (emAndamento) throw new ErroBelenus('Já tem uma cotação da Belenus em andamento. Espere ela terminar (cerca de 1 minuto) e mande de novo.')
  emAndamento = true
  try {
    return await montar(entrada)
  } finally {
    emAndamento = false
  }
}

async function montar(entrada: EntradaCotacao): Promise<ResultadoCotacao> {
  const avisos: string[] = []
  const site = siteBelenus()
  const ligacaoLead: Ligacao = entrada.ligacao ?? 'monofásico'
  if (!entrada.ligacao) avisos.push('Medidor do lead não informado: supus MONOFÁSICO 220 V. Confirme com o cliente.')
  const tensao = entrada.tensao ?? 220
  if (!entrada.tensao && entrada.ligacao) avisos.push(`Tensão do lead não informada: supus ${tensao} V.`)
  const telhado: Telhado = entrada.telhado ?? 'colonial'
  if (!entrada.telhado) avisos.push('Tipo de telhado do lead não informado: usei estrutura COLONIAL. Confirme com o cliente.')

  const sessao: SessaoBelenus = await loginBelenus()
  const post = (rota: string, corpo: unknown, etapa: string) => chamarBelenus(P + rota, corpo, { token: sessao.token, etapa })

  // 1) MÓDULOS — corpo capturado do site real: { site, potenciaProjeto, modulo:"", qtde:0, fabricantes:[{fabricante:""}] }
  const rMod = await post('Modulos', { site, potenciaProjeto: entrada.kwp, modulo: '', qtde: 0, fabricantes: [{ fabricante: '' }] }, 'módulos')
  const modulos = listaDe(rMod, 'modulos')
  if (!modulos.length) throw new ErroBelenus(`A Belenus não devolveu módulos para ${entrada.kwp} kWp.`)
  const modulo = escolherModulo600(modulos)
  if (!modulo) throw new ErroBelenus('Nenhum módulo na faixa de 600 W (600–699 W) na lista da Belenus. Cote manualmente.')
  const qtdModulos = num(campo(modulo, 'numeroModulos', 'qtdSugerida', 'qtde'))
  if (!(qtdModulos > 0)) throw new ErroBelenus('A Belenus não sugeriu a quantidade de módulos (formato inesperado — veja o log [belenus]).')
  const potenciaKit = num(campo(modulo, 'potenciaMaxima', 'potenciaSugerida'))
  // INFO_KIT do site: o módulo escolhido com potenciaProjeto = potenciaMaxima (goToInversor)
  const kit: Obj = { ...modulo, numeroModulos: qtdModulos, potenciaProjeto: Number.isFinite(potenciaKit) && potenciaKit > 0 ? potenciaKit : entrada.kwp }
  const kitKwp = Number(kit.potenciaProjeto)

  // 2) INVERSOR — filtros em cascata (InversorFiltro) e depois a lista (Inversor), como na tela do site
  const filtroBase = (f: Partial<Record<'tipoInversor' | 'tipoLigacao' | 'tensaoNominal', string>>) => ({
    site, modulo: kit.item, inversor: '', potenciaProjeto: kitKwp,
    tipoLigacao: f.tipoLigacao ?? '', tipoInversor: f.tipoInversor ?? '', tensaoNominal: f.tensaoNominal ?? '',
    qtdeModulo: qtdModulos, fabricantes: [{ fabricante: '' }],
  })
  const dadosFiltro = (r: unknown): Obj => (ehObj(r) && ehObj(r.data) ? r.data : {})
  const rTipos = await post('InversorFiltro', filtroBase({}), 'filtro inversor (tipo)')
  const listaTipos = (dadosFiltro(rTipos).listTipoInversor as unknown[]) ?? []
  const tipoInversorAchado = escolherOpcao(listaTipos, 'tipoInversor', RE_ON_GRID, RE_NAO_ON_GRID)
  if (!tipoInversorAchado) throw new ErroBelenus(`Não achei o tipo de inversor ON-GRID nos filtros da Belenus (opções: ${listaTipos.map((o) => opcaoTexto(o, 'tipoInversor')).join(', ') || 'nenhuma'}).`)
  const tipoInversor: string = tipoInversorAchado

  async function buscarInversores(lig: Ligacao, v: number) {
    const rLig = await post('InversorFiltro', filtroBase({ tipoInversor }), 'filtro inversor (ligação)')
    const listaLig = (dadosFiltro(rLig).listTipoLigacao as unknown[]) ?? []
    const tipoLigacao = escolherOpcao(listaLig, 'tipoLigacao', reLigacao(lig))
    if (!tipoLigacao) throw new ErroBelenus(`Não achei inversor ${lig === 'trifásico' ? 'trifásico' : 'monofásico'} nos filtros da Belenus (opções: ${listaLig.map((o) => opcaoTexto(o, 'tipoLigacao')).join(', ') || 'nenhuma'}).`)
    const rTen = await post('InversorFiltro', filtroBase({ tipoInversor, tipoLigacao }), 'filtro inversor (tensão)')
    const listaTen = (dadosFiltro(rTen).listTensaoNominal as unknown[]) ?? []
    const tensaoNominal = escolherOpcao(listaTen, 'tensaoNominal', reTensao(v)) ?? escolherOpcao(listaTen, 'tensaoNominal', /220/)
    if (!tensaoNominal) throw new ErroBelenus(`Não achei a tensão ${v} V nos filtros da Belenus (opções: ${listaTen.map((o) => opcaoTexto(o, 'tensaoNominal')).join(', ') || 'nenhuma'}).`)
    const rFab = await post('InversorFiltro', filtroBase({ tipoInversor, tipoLigacao, tensaoNominal }), 'filtro inversor (fabricante)')
    const listaFab = (dadosFiltro(rFab).listFabricante as unknown[]) ?? []
    const auxsol = listaFab.map((o) => opcaoTexto(o, 'fabricante')).find((f) => f.toUpperCase().includes(MARCA_PREFERIDA))
    const corpo = (fab: string) => ({
      site, modulo: kit.item, inversor: '', potenciaProjeto: kitKwp, tipoLigacao, tipoInversor, tensaoNominal,
      qtdeModulo: qtdModulos, qtde: 0, fabricantes: [{ fabricante: fab }],
    })
    let r = await post('Inversor', corpo(auxsol ?? ''), `inversores${auxsol ? ' (AUXSOL)' : ''}`)
    let lista = listaDe(r, 'inversores')
    let escolha = escolherInversor(lista, { limiteKw: lig === 'trifásico' || ligacaoLead !== 'monofásico' ? undefined : LIMITE_MONOFASICO_KW })
    if (auxsol && !('inversor' in escolha)) {
      // AUXSOL não serviu: tenta com todas as marcas
      r = await post('Inversor', corpo(''), 'inversores (todas as marcas)')
      lista = listaDe(r, 'inversores')
      escolha = escolherInversor(lista, { limiteKw: lig === 'trifásico' || ligacaoLead !== 'monofásico' ? undefined : LIMITE_MONOFASICO_KW })
    }
    const parametros = ehObj(r) && ehObj(r.data) ? r.data.parametros : undefined
    return { escolha, parametros, tipoLigacao, tensaoNominal, temAuxsol: !!auxsol }
  }

  let ligacaoSistema: Ligacao = ligacaoLead
  let inv = await buscarInversores(ligacaoSistema, tensao)
  if (!('inversor' in inv.escolha) && ligacaoSistema !== 'trifásico') {
    const motivo = inv.escolha.motivo
    // regra do dono: mais de 1 inversor → 1 inversor TRIFÁSICO; medidor monofásico acima de 5 kW → transformador
    ligacaoSistema = 'trifásico'
    if (ligacaoLead === 'monofásico') avisos.push(`Medidor monofásico e o sistema precisa de inversor acima de ${LIMITE_MONOFASICO_KW} kW: precisa do TRANSFORMADOR (+R$ ${TRANSFORMADOR_PRECO}). Usei 1 inversor trifásico.`)
    else avisos.push(motivo === 'mais-de-um' ? 'A Belenus sugeriu mais de 1 inversor: troquei por 1 inversor TRIFÁSICO (regra do dono).' : 'Nenhum inversor monofásico único atende: usei 1 inversor TRIFÁSICO.')
    inv =await buscarInversores('trifásico', ligacaoLead === 'trifásico' ? tensao : 220)
  }
  if (!('inversor' in inv.escolha)) throw new ErroBelenus('Não achei 1 inversor on-grid que atenda este kit na Belenus. Cote manualmente.')
  const inversorObj = inv.escolha.inversor
  if (inv.escolha.qtdeSugeridaBelenus > 1) avisos.push(`A Belenus sugeriu ${inv.escolha.qtdeSugeridaBelenus} unidades deste inversor; usei 1.`)
  if (!ehMarcaPreferida(inversorObj)) avisos.push(inv.temAuxsol ? 'Nenhum AUXSOL serviu para este kit: usei outra marca.' : 'AUXSOL não aparece nos filtros da Belenus para este kit: usei outra marca.')
  // INVERSORES_SELECIONADOS do site (+ inversor/inversorQtde, getFromStorageInversor)
  const inversorSel: Obj = { ...inversorObj, numInversores: 1, inversor: inversorObj.item, inversorQtde: 1 }

  // 2b) ConferirPotenciaInversor (validação do site antes de ir para a estrutura) — só consulta
  await post('ConferirPotenciaInversor', { listInversores: [inversorSel], potenciaProjeto: kitKwp, parametros: inv.parametros }, 'conferir potência do inversor')

  // 3) ESTRUTURA — TipoEstrutura { modulo } → escolhe pelo telhado; Estrutura com o layout (1 linha × N módulos)
  const rTipoEst = await post('TipoEstrutura', { modulo: kit.item }, 'tipos de estrutura')
  const grupos = listaDe(rTipoEst, 'listTipos')
  const re = PALAVRAS_TELHADO[telhado]
  const txt = (o: unknown) => String(o ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  let grupo: Obj | undefined, sub: Obj | undefined
  for (const g of grupos) {
    const subs = Array.isArray(g.subGrupo) ? (g.subGrupo as unknown[]).filter(ehObj) : []
    const s = subs.find((x) => re.test(txt(`${g.grupo} ${x.subGrupo} ${x.tipo}`)))
    if (s) { grupo = g; sub = s; break }
  }
  if (!grupo || !sub) throw new ErroBelenus(`Não achei estrutura para telhado ${telhado} na Belenus (grupos: ${grupos.map((g) => String(g.grupo)).join(', ') || 'nenhum'}). Cote manualmente.`)
  const orientacoes = Array.isArray(grupo.orientacao) ? (grupo.orientacao as unknown[]) : []
  const orientacao = opcaoTexto(orientacoes.find((o) => /retrato/i.test(opcaoTexto(o, 'descricao'))) ?? orientacoes[0], 'descricao') || 'Retrato'
  const layout = [{
    arranjo: 1, linhas: 1, moduloLinha: qtdModulos, orientacao,
    tipoEstrutura: sub.tipo, grupo: grupo.grupo, subGrupo: sub.subGrupo, observation: sub.observation,
  }]
  const rEst = await post('Estrutura', {
    semEstrutura: false, site, potenciaProjeto: kitKwp, sugestao: 1, modulo: kit.item, moduloQtde: qtdModulos,
    layout, listInversores: [inversorSel],
  }, 'estrutura')
  const estruturaObjs = semRepetidos(listaDe(rEst, 'structure', 'estrutura', 'estruturas')).filter((e) => qtdeDe(e) > 0)
  if (!estruturaObjs.length) avisos.push('A Belenus não devolveu itens de estrutura (veja o log [belenus] estrutura).')
  // ESTRUTURA do site (+ estrutura/estruturaQtde, getFromStorageEstrutura)
  const listStructure = estruturaObjs.map((e) => ({ ...e, estrutura: e.item, estruturaQtde: e.qtde }))

  // 4) COMPONENTES CC (Outros) — sugeridos (sugestao 1) e a lista completa (sugestao 0, para achar o cabo 6 mm)
  const corpoOutros = (sugestao: number) => ({
    site, potenciaProjeto: kitKwp, modulo: kit.item, sugestao, moduloQtde: qtdModulos,
    listInversores: [inversorSel], semEstrutura: false, layout,
    ...(listStructure.length ? { ListStructure: listStructure } : {}),
  })
  const ccSug = semRepetidos(listaDe(await post('Outros', corpoOutros(1), 'componentes CC (sugeridos)'), 'outros')).filter((o) => qtdeDe(o) > 0)
  const ccTodos = semRepetidos(listaDe(await post('Outros', corpoOutros(0), 'componentes CC (todos)'), 'outros'))
  // 5) COMPONENTES CA (OutrosAC)
  const caSug = semRepetidos(listaDe(await post('OutrosAC', corpoOutros(1), 'componentes CA (sugeridos)'), 'outrosAC', 'outros')).filter((o) => qtdeDe(o) > 0)
  // PARE: o próximo passo do site é api/carrinho/KitPersonalizado/Confirmar (cria carrinho) — proibido na Fase 1.

  // Regras do dono: strings, cabos e DPS
  const strings = calcularStrings(qtdModulos)
  // DPS: a regra do dono (2 mono/bi, 3 tri) vale no DPS do lado CA quando a Belenus sugerir um; senão no do CC
  const temDpsCa = caSug.some((o) => ehDps(descricaoDe(o)))
  const cc = aplicarRegrasComponentes(ccSug.map(paraPeca), ccTodos.map(paraPeca), strings, ligacaoSistema, { aplicarDps: !temDpsCa })
  // cabos de string (preto/vermelho/verde) são do lado CC: no CA só o DPS
  const ca = aplicarRegrasComponentes(caSug.map(paraPeca), [], strings, ligacaoSistema, { aplicarCabos: false, aplicarDps: temDpsCa })
  if (!temDpsCa && !cc.pecas.some((p) => ehDps(p.descricao))) avisos.push('Nenhum DPS veio nas sugestões da Belenus: incluir manualmente.')

  const moduloPeca = {
    ...paraPeca(modulo), qtde: qtdModulos,
    potenciaW: potenciaW(campo(modulo, 'potencia')), potenciaKitKwp: Number.isFinite(potenciaKit) && potenciaKit > 0 ? potenciaKit : null,
  }
  const inversorPeca = {
    ...paraPeca(inversorObj), qtde: 1,
    potenciaKw: potenciaKw(campo(inversorObj, 'potenciaNominalSaida', 'potencia', 'maxPotenciaSaida')),
    ligacao: String(campo(inversorObj, 'tipoLigacao') ?? inv.tipoLigacao), tensao: String(campo(inversorObj, 'tensaoSaida', 'tensaoNominal') ?? inv.tensaoNominal),
  }
  const estrutura = estruturaObjs.map(paraPeca)
  const todas = [moduloPeca, inversorPeca, ...estrutura, ...cc.pecas, ...ca.pecas]
  return {
    potenciaPedidaKwp: entrada.kwp,
    modulo: moduloPeca, inversor: inversorPeca, estrutura, componentesCC: cc.pecas, componentesCA: ca.pecas,
    strings, avisos, ajustes: [...cc.ajustes, ...ca.ajustes],
    totalProdutos: totalSeTiverPreco(todas),
  }
}

// ── Comando na conversa do lead ──────────────────────────────────────────────
export type RetornoComandoBelenus = { tratado: false } | { tratado: true; texto: string; resultado: ResultadoCotacao }

/**
 * "cota belenus <kWp>" (mensagem inteira). Monta o kit na Belenus e grava uma NOTA INTERNA no lead.
 * O texto do comando NUNCA vai ao cliente. Erro → lança Error com a mensagem para a tela.
 */
export async function comandoCotaBelenus(leadId: string, conversationId: string | null, text: string): Promise<RetornoComandoBelenus> {
  const cmd = lerComandoBelenus(text)
  if (!cmd) return { tratado: false }
  if ('erro' in cmd) throw new Error(cmd.erro)
  const { prisma } = await import('@/lib/prisma')
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  // 🔋 híbrido/bateria não é automático (regra do dono)
  const { leadQuerHibrido } = await import('../hibrido')
  if (await leadQuerHibrido(leadId, conversationId, '')) throw new Error('Sistema com bateria precisa de mais informações; cote manualmente. Nada foi enviado ao cliente.')

  let kwp = cmd.kwp
  let estimado = false
  if (kwp == null) {
    const solar = ehObj(cf.solar) ? cf.solar : {}
    let kwh = num(cf.consumoKwh ?? solar.consumoKwh)
    if (!(kwh > 0)) {
      const conta = num(cf.billValue ?? solar.contaReais)
      if (conta > 0) {
        const { reaisParaKwh } = await import('../solar-calc')
        kwh = reaisParaKwh(conta)
      }
    }
    if (!(kwh > 0)) throw new Error('Não sei a potência: o lead não tem consumo nem valor de conta. Escreva "cota belenus 4,34 kWp". Nada foi enviado ao cliente.')
    kwp = kwpPorConsumo(kwh)
    estimado = true
  }

  const ligacao = lerLigacao(cf.medidor)
  const tensao = lerTensao(cf.tensao ?? cf.tensaoAtendimento ?? cf.voltagem)
  const telhado = lerTelhado(cf.telhado ?? cf.tipoTelhado)
  let resultado: ResultadoCotacao
  try {
    resultado = await montarKitBelenus({ kwp, ligacao, tensao, telhado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na cotação da Belenus.'
    console.error('[belenus] cotação falhou:', msg)
    await prisma.note.create({ data: { leadId, type: 'system', content: `🤖 Cotação Belenus (${kwp} kWp) não concluída: ${msg}` } }).catch(() => {})
    throw new Error(`${msg} Nada foi enviado ao cliente.`)
  }
  if (estimado) resultado.avisos.unshift(`Potência estimada pelo consumo do lead (1 painel = 60 kWh, painel de 620 W): ${kwp.toLocaleString('pt-BR')} kWp. Confira.`)
  const texto = textoNota(resultado)
  await prisma.note.create({ data: { leadId, type: 'system', content: texto } })
  return { tratado: true, texto, resultado }
}
