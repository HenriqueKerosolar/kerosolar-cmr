// 📄 PDF do orçamento KeroSolar (Fase 3) — desenhado pela peça @lib/proposta-pdf (Biblioteca, atende o REQ-047).
// Aqui fica só o que é da KeroSolar: dados da empresa, logo, cores da marca e os textos do modelo aprovado pelo dono
// (caixas com borda #D9DCE1, títulos com linha amarela #F5B400, texto #1F2328, Helvetica).

import path from 'path'
import PDFDocument from 'pdfkit'
import { gerarPropostaPdf, formatarMoedaBR, type ConstrutorPdf, type DadosProposta } from '@lib/proposta-pdf'
import type { DadosOrcamento } from './orcamento'

export const CAMINHO_LOGO = path.join(process.cwd(), 'public', 'orcamento', 'logo-wordmark.png')

/** Cores da marca KeroSolar. */
export const CORES_KEROSOLAR = {
  destaque: '#F07A12', linhaTitulo: '#F5B400', texto: '#1F2328', secundario: '#5B6169', borda: '#D9DCE1',
  fundo: '#F6F7F9', positivo: '#1E8E3E', item: '#3A3F45', alerta: '#B45309',
}

/** Dados da empresa no cabeçalho. */
export const EMPRESA_KEROSOLAR = {
  nome: 'KEROSOLAR ENERGIA & TECNOLOGIA',
  cnpj: '34.307.552/0001-69',
  endereco: ['R A, 37 CASA 01 - VILA PROGRESSO', 'Niterói - RJ   CEP: 24320-480'],
  contatos: ['FONE / WHATSAPP: (21) 2027-6013', 'kerosolar@kerosolar.com.br · www.kerosolar.com.br'],
  marca: 'KeroSolar',
}

const brl = formatarMoedaBR
const num = (v: number, casas = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** Dados do orçamento KeroSolar → proposta genérica da peça (mesmos textos do modelo aprovado). */
export function paraProposta(d: DadosOrcamento, opts: { logo?: string | Buffer | null } = {}): DadosProposta {
  return {
    titulo: `Orçamento ${d.numero}`,
    metadados: { titulo: `Orçamento KeroSolar ${d.numero} - ${d.cliente.nome}`, autor: 'KeroSolar Energia & Tecnologia' },
    empresa: { ...EMPRESA_KEROSOLAR, logo: opts.logo === undefined ? CAMINHO_LOGO : opts.logo },
    emissao: `Emissão em ${d.emissao}, válido por 3 dias ou enquanto durarem os estoques.`,
    cliente: {
      nome: d.cliente.nome, cidadeUf: d.cliente.cidadeUf, telefone: d.cliente.telefone,
      ...(d.cliente.email ? { email: d.cliente.email } : {}),
      ...(d.cliente.endereco ? { endereco: d.cliente.endereco } : {}),
      ...(d.cliente.cep ? { cep: d.cliente.cep } : {}),
    },
    seloCliente: 'Sistema instalado e homologado',
    condicaoPagamento: 'PIX (à vista, 5% de desconto), financiamento bancário ou cartão de crédito',
    resumo: {
      titulo: `Potência do sistema: ${num(d.kwp, 2)} kWp`,
      subtitulo: `Geração estimada: ~${num(d.geracaoMes)} kWh/mês (~${num(d.geracaoAno)} kWh/ano)`,
      tabela: {
        larguras: [22, 72, 16, 28, 24],
        linhas: [
          ['Tipo estrutura', 'Detalhes da estrutura', 'Linhas', 'Módulos por linha', 'Orientação'],
          [d.estrutura.tipo, d.estrutura.detalhes, String(d.estrutura.linhas), String(d.estrutura.modulosPorLinha), d.estrutura.orientacao],
        ],
      },
    },
    itens: d.produtos.map((p) => ({ nome: p.nome, ...(p.fabricante ? { fabricante: p.fabricante } : {}), quantidade: p.qtde })),
    servicosInclusos: 'projeto elétrico, instalação completa, homologação junto à concessionária e frete dos equipamentos até o local.',
    valores: {
      total: d.valorTotal,
      linhas: [
        { rotulo: '+ Equipamentos, instalação e homologação:', valor: d.valorTotal },
        { rotulo: '+ Frete:', valor: 'Incluso' },
        { rotulo: '+ Projeto elétrico:', valor: 'Incluso' },
      ],
      aVista: { valor: d.valorPix, rotulo: 'À vista no PIX (5% de desconto):', chamada: `ou ${brl(d.valorPix)} à vista no PIX` },
    },
    pagamentos: {
      tabelas: [
        {
          titulo: 'Financiamento bancário', subtitulo: '1ª parcela só daqui a 120 dias', cabecalho: ['Prazo', 'Parcela'],
          linhas: d.financiamento.map((f) => ({ rotulo: `${f.prazo}x`, valor: f.parcela })),
        },
        {
          titulo: 'Cartão de crédito', subtitulo: 'Até 3x sem juros', cabecalho: ['Nº', 'Parcela'], colunas: 2,
          linhas: d.cartao.map((c) => ({ rotulo: `${c.n}x`, valor: c.parcela, ...(c.semJuros ? { marca: 's/ juros' } : {}) })),
        },
      ],
    },
    ...(d.economia ? {
      economia: {
        indicadores: [
          { rotulo: 'Conta de luz hoje', valor: brl(d.economia.contaHoje) },
          { rotulo: 'Economia por mês', valor: `~${brl(d.economia.mes)}` },
          { rotulo: 'Economia por ano', valor: `~${brl(d.economia.ano)}` },
          { rotulo: 'Retorno do investimento', valor: `~${num(d.economia.retornoAnos, 1)} anos` },
          { rotulo: 'Economia em 30 anos', valor: `~${brl(d.economia.trintaAnos)}` },
        ],
        nota: `Estimativa com base no consumo informado (${num(d.economia.consumoKwh)} kWh/mês). Sempre continua a taxa mínima da concessionária (custo de disponibilidade) e a iluminação pública.`,
      },
    } : {}),
    garantias: {
      linhas: [
        ['Painéis solares (produção mínima de 80% em 30 anos)', '30 anos'],
        ['Inversor', '10 anos'],
        ['Estrutura de fixação', '25 anos'],
        ['Mão de obra (instalação)', '2 anos'],
      ],
    },
    prazos: {
      linhas: [
        { etapa: 'Entrega dos equipamentos', prazo: '~20 dias (com estoque)' },
        { etapa: 'Instalação', prazo: '~5 dias úteis após a entrega' },
        { etapa: 'Homologação na concessionária (projeto, vistoria e troca do medidor)', prazo: 'algumas semanas' },
        { etapa: 'Total, do fechamento à energia gerando', prazo: 'até 60 dias', destaque: true },
      ],
    },
    validade: { destaque: 'Validade da proposta: 3 dias', texto: ` (até ${d.validaAte}) — os preços dos equipamentos dependem do estoque do fornecedor.` },
    notaGarantias: 'Aplicativo de monitoramento da geração incluso.',
    observacoes: d.observacoes,
    cores: CORES_KEROSOLAR,
  }
}

export async function gerarPdfOrcamento(d: DadosOrcamento, opts: { logo?: string | null } = {}): Promise<Buffer> {
  return gerarPropostaPdf(paraProposta(d, opts), { PDFDocument: PDFDocument as unknown as ConstrutorPdf, formatarMoeda: brl })
}
