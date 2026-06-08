import 'server-only'

/**
 * FAQ GLOBAL — respostas-padrão que valem em qualquer etapa, mesmo com a IA
 * da etapa desligada (desde que a etapa tenha automação). São respostas fixas,
 * não acionam a IA conversacional.
 */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const RESPOSTA_QUANTO_CAI =
  'Não é uma pergunta fácil de responder, porque cada pessoa ou empresa tem um perfil de consumo diferente, ' +
  'medidores diferentes com taxas mínimas diferentes, taxas fixas como iluminação pública e ainda as taxas ' +
  'variáveis como as bandeiras vigentes. Mas posso dizer que a economia fica de 70% até 85% — ou até mais. ' +
  'E quanto maior o consumo de energia, maior a economia! 😊'

type FaqRule = { id: string; patterns: RegExp[]; answer: string }

const RULES: FaqRule[] = [
  {
    id: 'quanto_cai',
    patterns: [
      /pra?\s+quanto\s+(minha\s+)?conta\s+(cai|fica|vai|baixa)/,
      /quanto\s+(vou|vai|eu vou)\s+pagar/,
      /quanto\s+(fica|cai|vai ficar)\s+(a\s+)?(minha\s+)?conta/,
      /qual\s+(a|seria a)\s+economia/,
      /quanto\s+(vou|vai|eu)\s+economiz/,
      /reduz\s+(pra|para)\s+quanto/,
      /conta\s+vai\s+pra?\s+quanto/,
    ],
    answer: RESPOSTA_QUANTO_CAI,
  },
  {
    id: 'a_vista',
    patterns: [
      /a\s*vista/,
      /pagar?\s+(tudo|de uma vez|no dinheiro|no pix|adiantado)/,
      /desconto\s+(a\s*vista|no pix|no dinheiro|pagamento)/,
      /(tem|tem algum|qual o|qual)\s+desconto/,
    ],
    answer: 'Sim! 😊 No pagamento à vista você tem 5% de desconto. Quer que eu calcule o valor já com o desconto?',
  },
]

/** Retorna a resposta global se a mensagem casar com alguma FAQ; senão null. */
export function matchGlobalFaq(text: string): string | null {
  const t = norm(text)
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(t))) return rule.answer
  }
  return null
}
