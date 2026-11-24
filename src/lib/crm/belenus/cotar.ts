import 'server-only'
// 🤖 Orquestra a cotação na Belenus, na mesma ordem do "Gerador Personalizado":
//   login → Módulos → filtros do inversor → Inversor → ConferirPotenciaInversor → TipoEstrutura → Estrutura
//   → Outros (CC) → OutrosAC (CA) → [Fase 2] etapa 6 "Confirmação" (Confirmar, UMA vez) → frete (BuscarFretes,
//   só consulta) → seguro (ValorSeguro, só consulta)
// e PARA aí. A Confirmação gera a cotação "WEB-xxxxxxx" (a mesma que o dono gera à mão) só para LER o total.
// Nunca finaliza pedido (ConfirmarCarrinho), nunca grava frete/seguro/pagamento no carrinho (proibido).
// Disparo: comando do operador "cota belenus <kWp>" na conversa do lead (ver comandoCotaBelenus).

import { ErroBelenus, chamarBelenus, loginBelenus, siteBelenus, type SessaoBelenus } from './api'
import {
  DESTINO_PADRAO, ROTA_BUSCAR_FRETES, ROTA_CONFIRMAR, ROTA_SALVAR_ORCAMENTO, ROTA_VALOR_SEGURO, corpoSalvarOrcamento, numeroCotacaoDe, codigoDe, freteEntregaNoCliente, lerConfirmacao,
  lerDadosCliente, lerDestino, valorAoCliente, valorSeguroDe, type Confirmacao, type Peca,
} from './regras'
import {
  LIMITE_MONOFASICO_KW, MARCA_PREFERIDA, PALAVRAS_TELHADO, RE_NAO_ON_GRID, RE_ON_GRID, TRANSFORMADOR_PRECO,
  aplicarRegrasComponentes, calcularDps, calcularStrings, campo, descricaoDe, ehDps, ehMarcaPreferida, ehObj, escolherInversor, escolherMicro, LIMITE_MONOFASICO_220_KW, PLACAS_POR_MICRO,
  escolherModulo600, escolherOpcao, kwpPorConsumo, lerComandoBelenus, lerLigacao, lerTelhado, lerTensao, listaDe, num,
  opcaoTexto, paraPeca, potenciaKw, potenciaW, qtdeDe, reLigacao, reTensao, semRepetidos, textoNota,
  totalSeTiverPreco, type Ligacao, type Obj, type ResultadoCotacao, type Telhado,
} from './regras'

export type EntradaCotacao = {
  kwp: number
  ligacao?: Ligacao | null   // medidor do lead
  tensao?: number | null     // V (do lead)
  telhado?: Telhado | null   // do lead
  micro?: boolean            // cliente pediu micro inversor → DEYE, 1 para cada 4 placas
  destino?: { cidade: string; uf: string } | null   // município do lead (frete); sem ele → Rio de Janeiro - RJ
  nomeCliente?: string | null                         // nome do contato do lead (nome do orçamento salvo na Belenus)
  entrega?: { rua?: string; numero?: string; bairro?: string; complemento?: string; cep?: string | null } | null
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
  const ligacaoLead: Ligacao = entrada.ligacao ?? 'bifásico'
  if (!entrada.ligacao) avisos.push('Medidor do lead não informado: supus BIFÁSICO 220 V. Confirme com o cliente.')
  const tensao = entrada.tensao ?? 220
  if (!entrada.tensao && entrada.ligacao) avisos.push(`Tensão do lead não informada: supus ${tensao} V.`)
  const telhado: Telhado = entrada.telhado ?? 'colonial'
  const ajustesEstrutura: string[] = []
  if (!entrada.telhado) avisos.push('Tipo de telhado do lead não informado: usei estrutura CERÂMICO/COLONIAL (regra do dono). Confirme com o cliente.')

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
  const tipoInversorAchado = entrada.micro
    ? escolherOpcao(listaTipos, 'tipoInversor', /micro/)
    : escolherOpcao(listaTipos, 'tipoInversor', RE_ON_GRID, RE_NAO_ON_GRID)
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
    const auxsol = listaFab.map((o) => opcaoTexto(o, 'fabricante')).find((f) => f.toUpperCase().includes(entrada.micro ? 'DEYE' : MARCA_PREFERIDA))
    const corpo = (fab: string) => ({
      site, modulo: kit.item, inversor: '', potenciaProjeto: kitKwp, tipoLigacao, tipoInversor, tensaoNominal,
      qtdeModulo: qtdModulos, qtde: 0, fabricantes: [{ fabricante: fab }],
    })
    let r = await post('Inversor', corpo(auxsol ?? ''), `inversores${auxsol ? ' (AUXSOL)' : ''}`)
    let lista = listaDe(r, 'inversores')
    // Dono (24/11/2026): MEDIDOR MONOFÁSICO da concessionária → inversor até 5 kW (qualquer tensão). Bifásico/trifásico:
    // regra normal (inversor mono 220 V até 10 kW quando couber, 50% de overload).
    const limiteMono = LIMITE_MONOFASICO_KW
    const optsEsc = { limiteKw: lig === 'trifásico' || ligacaoLead !== 'monofásico' ? undefined : limiteMono, kwpKit: kitKwp }
    // 1º só AUXSOL na faixa (overload 100%); sem AUXSOL na faixa → todas as marcas na faixa; por último o menor que atende
    let escolha = entrada.micro ? escolherMicro(lista) : escolherInversor(lista, { ...optsEsc, somenteFaixa: !!auxsol })
    if (auxsol && !('inversor' in escolha)) {
      // AUXSOL não serviu: tenta com todas as marcas
      r = await post('Inversor', corpo(''), 'inversores (todas as marcas)')
      lista = listaDe(r, 'inversores')
      escolha = entrada.micro ? escolherMicro(lista) : escolherInversor(lista, optsEsc)
    }
    console.log(`[belenus] inversores disponíveis: ${lista.map((i) => `${String(i.item)}=${String(i.potenciaNominalSaida)}kW`).join(', ')}`)
    const parametros = ehObj(r) && ehObj(r.data) ? r.data.parametros : undefined
    return { escolha, parametros, tipoLigacao, tensaoNominal, temAuxsol: !!auxsol }
  }

  let ligacaoSistema: Ligacao = ligacaoLead
  let inv = await buscarInversores(ligacaoSistema, tensao)
  if (!entrada.micro && !('inversor' in inv.escolha) && ligacaoSistema !== 'trifásico') {
    const motivo = inv.escolha.motivo
    // regra do dono: mais de 1 inversor → 1 inversor TRIFÁSICO; medidor monofásico acima de 5 kW → transformador
    ligacaoSistema = 'trifásico'
    if (ligacaoLead === 'monofásico') avisos.push(`O kit passa do que o medidor MONOFÁSICO aguenta (inversor de ${LIMITE_MONOFASICO_KW} kW com até 85% de overload = ${(LIMITE_MONOFASICO_KW * 1.85).toFixed(2).replace('.', ',')} kWp). Usei 1 inversor trifásico: confira com o cliente a troca do padrão.`)
    else avisos.push(motivo === 'mais-de-um' ? 'A Belenus sugeriu mais de 1 inversor: troquei por 1 inversor TRIFÁSICO (regra do dono).' : 'Nenhum inversor monofásico único atende: usei 1 inversor TRIFÁSICO.')
    inv =await buscarInversores('trifásico', ligacaoLead === 'trifásico' ? tensao : 220)
  }
  if (!('inversor' in inv.escolha)) throw new ErroBelenus('Não achei 1 inversor on-grid que atenda este kit na Belenus. Cote manualmente.')
  const inversorObj = inv.escolha.inversor
  // Dono (24/11/2026): medidor monofásico → SEMPRE transformador.
  if (ligacaoLead === 'monofásico') avisos.push(`Medidor MONOFÁSICO: sempre com TRANSFORMADOR (+R$ ${TRANSFORMADOR_PRECO}) — regra do dono.`)
  const qtdInversores = entrada.micro ? Math.ceil(qtdModulos / PLACAS_POR_MICRO) : 1
  if (entrada.micro) avisos.push(`Micro inversor DEYE: ${qtdInversores} unidade(s) (1 para cada ${PLACAS_POR_MICRO} placas — regra do dono). Confira os cabos: no micro a ligação é em CA.`)
  else if (inv.escolha.qtdeSugeridaBelenus > 1) avisos.push(`A Belenus sugeriu ${inv.escolha.qtdeSugeridaBelenus} unidades deste inversor; usei 1.`)
  if (!entrada.micro && !ehMarcaPreferida(inversorObj)) avisos.push(inv.temAuxsol ? 'Nenhum AUXSOL serviu para este kit: usei outra marca.' : 'AUXSOL não aparece nos filtros da Belenus para este kit: usei outra marca.')
  // INVERSORES_SELECIONADOS do site (+ inversor/inversorQtde, getFromStorageInversor)
  const inversorSel: Obj = { ...inversorObj, numInversores: qtdInversores, inversor: inversorObj.item, inversorQtde: qtdInversores }

  // 2b) ConferirPotenciaInversor (validação do site antes de ir para a estrutura) — só consulta
  await post('ConferirPotenciaInversor', { listInversores: [inversorSel], potenciaProjeto: kitKwp, parametros: inv.parametros }, 'conferir potência do inversor')

  // 3) ESTRUTURA — TipoEstrutura { modulo } → escolhe pelo telhado; Estrutura com o layout (1 linha × N módulos)
  // Regra do dono (24/11/2026): estrutura cotada de 4 em 4 painéis, arredondando para cima (38 → 40).
  const qtdEstrutura = Math.ceil(qtdModulos / 4) * 4
  if (qtdEstrutura !== qtdModulos) ajustesEstrutura.push(`Estrutura cotada para ${qtdEstrutura} painéis (${qtdModulos} arredondado de 4 em 4 — regra do dono).`)
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
    arranjo: 1, linhas: 1, moduloLinha: qtdEstrutura, orientacao,
    tipoEstrutura: sub.tipo, grupo: grupo.grupo, subGrupo: sub.subGrupo, observation: sub.observation,
  }]
  const rEst = await post('Estrutura', {
    semEstrutura: false, site, potenciaProjeto: kitKwp, sugestao: 1, modulo: kit.item, moduloQtde: qtdEstrutura,
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
  const objPorCodigo = new Map<string, Obj>()
  for (const o of [...ccTodos, ...ccSug, ...caSug]) if (codigoDe(o)) objPorCodigo.set(codigoDe(o), o)

  // Regras do dono: strings, cabos e DPS
  const strings = calcularStrings(qtdModulos)
  // DPS: a regra do dono (2 mono/bi, 3 tri) vale no DPS do lado CA quando a Belenus sugerir um; senão no do CC
  const temDpsCa = caSug.some((o) => ehDps(descricaoDe(o)))
  const ajustesExtra: string[] = []
  const cc = aplicarRegrasComponentes(ccSug.map(paraPeca), ccTodos.map(paraPeca), strings, ligacaoSistema, { aplicarDps: !temDpsCa })
  // cabos de string (preto/vermelho/verde) são do lado CC: no CA só o DPS
  const ca = aplicarRegrasComponentes(caSug.map(paraPeca), [], strings, ligacaoSistema, { aplicarCabos: false, aplicarDps: temDpsCa })
  // 24/11/2026 (teste real): a Belenus pode não sugerir DPS → busca na lista completa do CA (sugestao 0) e põe a
  // quantidade da regra do dono (2 mono/bifásico, 3 trifásico). Prefere DPS CA 275 V (rede 127/220 V).
  if (!temDpsCa && !cc.pecas.some((p) => ehDps(p.descricao))) {
    const caTodosObjs = semRepetidos(listaDe(await post('OutrosAC', corpoOutros(0), 'componentes CA (todos)'), 'outrosAC', 'outros'))
    for (const o of caTodosObjs) if (codigoDe(o) && !objPorCodigo.has(codigoDe(o))) objPorCodigo.set(codigoDe(o), o)
    const caTodos = caTodosObjs.map(paraPeca)
    const dpss = caTodos.filter((p) => ehDps(p.descricao))
    const dps = dpss.find((p) => /\bca\b/i.test(p.descricao) && /275\s*v/i.test(p.descricao)) ?? dpss.find((p) => /275\s*v/i.test(p.descricao)) ?? dpss[0]
    if (dps) {
      const q = calcularDps(ligacaoSistema)
      ca.pecas.push({ ...dps, qtde: q, ajuste: 'regra do dono (Belenus não sugeriu DPS)' })
      ajustesExtra.push(`DPS: incluído "${dps.descricao}" × ${q} (regra do dono: ${ligacaoSistema === 'trifásico' ? 'trifásico' : 'mono/bifásico'}).`)
    } else {
      avisos.push('Nenhum DPS veio nas sugestões nem no catálogo da Belenus: incluir manualmente.')
    }
  }

  const moduloPeca = {
    ...paraPeca(modulo), qtde: qtdModulos,
    potenciaW: potenciaW(campo(modulo, 'potencia')), potenciaKitKwp: Number.isFinite(potenciaKit) && potenciaKit > 0 ? potenciaKit : null,
  }
  const inversorPeca = {
    ...paraPeca(inversorObj), qtde: qtdInversores,
    potenciaKw: potenciaKw(campo(inversorObj, 'potenciaNominalSaida', 'potencia', 'maxPotenciaSaida')),
    ligacao: String(campo(inversorObj, 'tipoLigacao') ?? inv.tipoLigacao), tensao: String(campo(inversorObj, 'tensaoSaida', 'tensaoNominal') ?? inv.tensaoNominal),
  }
  const estrutura = estruturaObjs.map(paraPeca)
  const todas = [moduloPeca, inversorPeca, ...estrutura, ...cc.pecas, ...ca.pecas]

  // 6) CONFIRMAÇÃO (Fase 2, autorizada pelo dono) — lê total, frete e seguro. Falha aqui NÃO derruba o kit.
  let confirmacao: Confirmacao | null = null
  let etapa6: Etapa6 | null = null
  try {
    etapa6 = await confirmarParaLerTotal({
      post: (rota, corpo, etapa, cab) => chamarBelenus(rota, corpo, { token: sessao.token, etapa, cabecalhos: cab }),
      sessao, site, kit, kitKwp, qtdModulos, layout, inversorSel, qtdInversores,
      estrutura: estruturaObjs, cc: cc.pecas, ca: ca.pecas, objPorCodigo,
      destino: entrada.destino ?? null, avisos,
    })
    confirmacao = etapa6.conf
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    avisos.push(`Total não lido na Confirmação da Belenus: ${msg} O kit acima continua válido; confira o valor no site.`)
  }

  // 7) SALVAR A COTAÇÃO (Fase 4, autorizada pelo dono) — UMA vez, só se a Confirmação deu certo. Falha não derruba nada.
  let cotacaoSalva: ResultadoCotacao['cotacaoSalva'] = undefined
  if (etapa6 && confirmacao) {
    try {
      const corpo = corpoSalvarOrcamento(etapa6.carrinho, {
        nome: (entrada.nomeCliente ?? '').trim() || 'Cliente KeroSolar',
        destino: entrada.destino ?? DESTINO_PADRAO, freteOpcao: etapa6.freteOpcao, entrega: entrada.entrega ?? null,
      })
      const r = await chamarBelenus(ROTA_SALVAR_ORCAMENTO, corpo, { token: sessao.token, etapa: 'salvar cotação' })
      const dados: Obj = ehObj(r) && ehObj(r.data) ? r.data : {}
      const validade = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      cotacaoSalva = {
        numeroWeb: numeroCotacaoDe(dados),
        validaAte: validade.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }),
      }
      if (!cotacaoSalva.numeroWeb) avisos.push('A Belenus salvou a cotação mas não devolveu o número WEB: confira em "Meus orçamentos".')
    } catch (e) {
      cotacaoSalva = null
      avisos.push(`Não consegui salvar na Belenus (${e instanceof Error ? e.message : 'erro'}) — preço não garantido; gere à mão.`)
    }
  }
  const transformador = ligacaoLead === 'monofásico' ? TRANSFORMADOR_PRECO : 0
  return {
    potenciaPedidaKwp: entrada.kwp,
    modulo: moduloPeca, inversor: inversorPeca, estrutura, componentesCC: cc.pecas, componentesCA: ca.pecas,
    strings, avisos, ajustes: [...ajustesEstrutura, ...cc.ajustes, ...ca.ajustes, ...ajustesExtra],
    totalProdutos: confirmacao?.totalProdutos ?? totalSeTiverPreco(todas),
    confirmacao,
    cotacaoSalva,
    transformador: transformador || undefined,
    valorCliente: confirmacao ? valorAoCliente(confirmacao.total, transformador) : null,
    layoutEstrutura: {
      telhado, grupo: String(grupo.grupo ?? ''), subGrupo: String(sub.subGrupo ?? sub.tipo ?? ''),
      linhas: 1, modulosPorLinha: qtdEstrutura, orientacao,
    },
  }
}

// ── Etapa 6: Confirmação (api/carrinho/KitPersonalizado/Confirmar) ───────────
// Corpo = `confirmacaoKit()` do bundle: { site, potenciaProjeto, semEstrutura, mesesInatividade,
//   itens: [módulo, ...inversores, ...estrutura, ...stringBox, ...outros (CC), ...outrosCA], layout,
//   origemCarrinho: 4, potenciaSistema, qtdModulos, qtdInversores, totalMaxPotenciaEntrada, totalMaxPotenciaSaida }
// com cada item no formato de `montaFormatoEnvio()` + `tipoKitmontado`. Cabeçalho `X-CarrinhoId: ""` (carrinho novo).
type CtxConfirmar = {
  post: (rota: string, corpo: unknown, etapa: string, cab?: Record<string, string>) => Promise<unknown>
  sessao: SessaoBelenus; site: string; kit: Obj; kitKwp: number; qtdModulos: number; layout: unknown[]
  inversorSel: Obj; qtdInversores: number; estrutura: Obj[]; cc: Peca[]; ca: Peca[]; objPorCodigo: Map<string, Obj>
  destino: { cidade: string; uf: string } | null; avisos: string[]
}

/** Item "outro"/"estrutura" no formato de montaFormatoEnvio (ramo `qtde`). */
function itemOutro(o: Obj | undefined, codigo: string, qtde: number, tipo: string): Obj {
  return {
    item: codigo, qtde, fabricante: o?.fabricante, modelo: o?.modelo, numEntrada: o?.numEntrada, imagemMarca: o?.imagemMarca,
    numSaida: o?.numSaida, dimensoes: o?.dimensoes, grauProtecao: o?.grauProtecao, correnteEntradaMax: o?.correnteEntradaMax,
    tensaoMaxima: o?.tensaoMaxima, tipoKitmontado: tipo,
  }
}

export function corpoConfirmar(c: Omit<CtxConfirmar, 'post' | 'avisos' | 'destino'>): Obj {
  const k = c.kit, iv = c.inversorSel
  const modulo = {
    tipoKitmontado: 'modulo', item: k.item, qtde: c.qtdModulos, fabricante: k.fabricante, modelo: k.modelo,
    imagemMarca: k.imagemMarca, eficiencia: k.eficiencia, potencia: k.potencia,
  }
  const inversor = {
    item: iv.item ?? iv.sku, qtde: c.qtdInversores, fabricante: iv.fabricante, modelo: iv.modelo, imagemMarca: iv.imagemMarca,
    maxPotenciaSaida: iv.maxPotenciaSaida, maxPotenciaEntrada: iv.maxPotenciaEntrada, tipoInversor: iv.tipoInversor,
    tipoLigacao: iv.tipoLigacao, numMPPTs: iv.numMPPTs, numEntradaMPPT: iv.numEntradaMPPT,
    potencia: iv.potenciaNominalSaida ?? iv.potencia, index: iv.index,
    arranjoInversores: Array.isArray(iv.arranjoInversores) ? iv.arranjoInversores : [], tipoKitmontado: 'inversor',
  }
  const estrutura = c.estrutura.filter((e) => qtdeDe(e) > 0).map((e) => itemOutro(e, codigoDe(e), qtdeDe(e), 'estrutura'))
  const outros = c.cc.filter((p) => p.qtde > 0 && p.codigo).map((p) => itemOutro(c.objPorCodigo.get(p.codigo), p.codigo, p.qtde, 'outro'))
  const outrosCA = c.ca.filter((p) => p.qtde > 0 && p.codigo).map((p) => itemOutro(c.objPorCodigo.get(p.codigo), p.codigo, p.qtde, 'outroCA'))
  const num0 = (v: unknown) => (Number.isFinite(num(v)) ? num(v) : 0)
  const corpo: Obj = {
    site: c.site, potenciaProjeto: c.kitKwp, semEstrutura: false, mesesInatividade: c.sessao.mesesInatividade ?? 0,
    itens: [modulo, inversor, ...estrutura, ...outros, ...outrosCA], layout: c.layout, origemCarrinho: 4,
    potenciaSistema: c.kitKwp, qtdModulos: c.qtdModulos, qtdInversores: c.qtdInversores,
  }
  // o site soma 1× por linha de inversor (não multiplica pela quantidade) e só manda se > 0
  if (num0(iv.maxPotenciaEntrada) > 0) corpo.totalMaxPotenciaEntrada = num0(iv.maxPotenciaEntrada)
  if (num0(iv.maxPotenciaSaida) > 0) corpo.totalMaxPotenciaSaida = num0(iv.maxPotenciaSaida)
  return corpo
}

type Etapa6 = { conf: Confirmacao; carrinho: Obj; freteOpcao: Obj | null }

async function confirmarParaLerTotal(c: CtxConfirmar): Promise<Etapa6> {
  // UMA chamada ao Confirmar por cotação (sem nova tentativa: cada chamada gera uma cotação WEB no site)
  const r = await c.post(ROTA_CONFIRMAR, corpoConfirmar(c), 'confirmação (etapa 6)', { 'X-CarrinhoId': '' })
  const dados: Obj = ehObj(r) && ehObj(r.data) ? r.data : {}

  // Frete "Belenus Entrega no Cliente" para o município do lead (consulta BuscarFretes, como getOpcoesFrete).
  // O site só GRAVA o frete com AdicionarFrete — proibido —, então o valor é lido das opções e somado aqui.
  const destino = c.destino ?? DESTINO_PADRAO
  if (!c.destino) c.avisos.push(`Município do lead não informado: frete calculado para ${DESTINO_PADRAO.cidade} - ${DESTINO_PADRAO.uf} (regra do dono).`)
  let frete: { valor: number; descricao: string; opcao?: Obj } | null = null
  try {
    const itens = Array.isArray(dados.itens) ? (dados.itens as unknown[]).filter(ehObj) : []
    const precos = ehObj(itens[0]?.precos) ? (itens[0].precos as Obj) : {}
    const documentoIntegrador = dados.documentoIntegrador ? dados.documentoIntegrador
      : String(dados.grupoCliente ?? '').includes('INT') ? dados.clienteCnpjCpf : null
    const corpoFrete = {
      SiteID: precos.siteFaturamento ?? c.site, ValorPedido: dados.totalProdutos, Divisao: 'SOL',
      Cidade: destino.cidade, Estado: destino.uf, eKit: 1, pesoTotal: dados.peso,
      tipoUsuario: c.sessao.userType, liberarComprasMinimas: !!c.sessao.liberarComprasMinimas,
      itens: itens.map((i) => ({
        sku: i.sku, qtde: i.quantidade,
        componentes: Array.isArray(i.componentes) ? (i.componentes as unknown[]).filter(ehObj).map((x) => ({ sku: x.sku, qtde: Number(x.quantidade) })) : undefined,
      })),
      IntegradorDocumento: documentoIntegrador, ClienteDocumento: null,
    }
    frete = freteEntregaNoCliente(await c.post(`${ROTA_BUSCAR_FRETES}?calcularValores=true`, corpoFrete, 'frete (opções)'))
    if (!frete) c.avisos.push(`A Belenus não devolveu o valor de "Belenus Entrega no Cliente" para ${destino.cidade} - ${destino.uf}: o frete fica para o operador.`)
  } catch (e) {
    c.avisos.push(`Frete não calculado (${e instanceof Error ? e.message : 'erro'}): fica para o operador.`)
  }

  // Seguro (ValorSeguro: só calcula o valor; incluir no carrinho seria IncluirSeguro — proibido)
  let seguro: number | null = null
  try {
    seguro = valorSeguroDe(await c.post(ROTA_VALOR_SEGURO, dados, 'seguro (valor)'))
  } catch (e) {
    c.avisos.push(`Seguro não calculado (${e instanceof Error ? e.message : 'erro'}).`)
  }

  const conf = lerConfirmacao(r, { frete, seguro })
  c.avisos.push(`Pagamento: a cotação ficou na condição padrão do site${conf.pagamento ? ` (${conf.pagamento})` : ''}. O robô não troca para PIX (exigiria AlterarCarrinho, proibido) — se o PIX mudar o valor, ajuste no site.`)
  return { conf, carrinho: dados, freteOpcao: frete?.opcao ?? null }
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
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true, contact: { select: { name: true, phone: true, whatsappId: true, email: true, customFields: true } } } })
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
  const telhado = lerTelhado(cf.telhado ?? cf.tipoTelhado ?? cf.roofType)
  // frete: município do lead (customFields cidade/município + uf/estado); só CEP não basta (sem consulta externa)
  // dados do cliente (contato + customFields): cidade/UF (chaves reais: city/state), nome completo e endereço se houver
  const cli = lerDadosCliente(lead?.contact, cf)
  const destino = lerDestino(cli.cidade, cli.uf)
  const entrega = cli.endereco || cli.cep ? { ...(cli.endereco ?? {}), cep: cli.cep } : null
  let resultado: ResultadoCotacao
  try {
    resultado = await montarKitBelenus({ kwp, ligacao, tensao, telhado, micro: !!cmd.micro || /micro/i.test(String(cf.inversorTipo ?? cf.microInversor ?? '')), destino, nomeCliente: cli.nome, entrega })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na cotação da Belenus.'
    console.error('[belenus] cotação falhou:', msg)
    await prisma.note.create({ data: { leadId, type: 'system', content: `🤖 Cotação Belenus (${kwp} kWp) não concluída: ${msg}` } }).catch(() => {})
    throw new Error(`${msg} Nada foi enviado ao cliente.`)
  }
  if (estimado) resultado.avisos.unshift(`Potência estimada pelo consumo do lead (1 painel = 60 kWh, painel de 620 W): ${kwp.toLocaleString('pt-BR')} kWp. Confira.`)
  let texto = textoNota(resultado)
  // 📄 Fase 3: PDF do orçamento KeroSolar — fica SÓ para o operador (nota com link); vai ao cliente só com "envia orçamento"
  if (resultado.valorCliente != null && resultado.valorCliente > 0) {
    try {
      const { gerarOrcamentoDoLead, textoNotaPdf } = await import('./orcamento-cmd')
      texto += textoNotaPdf(await gerarOrcamentoDoLead(leadId, resultado))
    } catch (e) {
      console.error('[belenus] PDF do orçamento falhou:', e instanceof Error ? e.message : e)
      texto += `\n\n⚠️ PDF do orçamento não gerado: ${e instanceof Error ? e.message : 'erro'}`
    }
  } else {
    texto += '\n\n⚠️ PDF do orçamento não gerado: sem o total da Belenus.'
  }
  await prisma.note.create({ data: { leadId, type: 'system', content: texto } })
  return { tratado: true, texto, resultado }
}
