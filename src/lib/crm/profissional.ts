// 🧰 Profissional oferecendo TRABALHO para a KeroSolar (instalador freelance, eletricista, montador...) —
// regra do dono (18/11/2026): agradece, avisa que o contato fica salvo no cadastro e o lead vai para a
// etapa "Profissionais" (sem orçamento, sem ebook). Parte pura (testável).

const sem = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const OFICIO = '(instalador\\w*|montador\\w*|eletricista\\w*|tecnico\\w*|integrador\\w*|projetista\\w*|ajudante\\w*|mao de obra|equipe de instala\\w*|freela\\w*|free ?lance\\w*)'

export function ehProfissionalOferecendoTrabalho(texto: string): boolean {
  const t = sem(texto)
  if (!t.trim()) return false
  // "vcs tão precisando de instalador freelance", "precisam de eletricista?", "estão contratando?"
  if (new RegExp(`\\b(precisando|precisam|precisa|necessitando|contratando|contratam|procurando)\\b.{0,30}\\b${OFICIO}`).test(t)) return true
  // "sou instalador", "trabalho como eletricista", "tenho equipe de instalação"
  if (new RegExp(`\\b(sou|trabalho como|atuo como|presto servico)\\b.{0,25}\\b${OFICIO}`).test(t)) return true
  if (/\b(tenho|temos) (uma )?equipe (de instala\w*|de montagem|tecnica|de eletricistas)\b/.test(t)) return true
  // "quero trabalhar com vocês", "tem vaga?", "currículo"
  if (/\b(trabalhar (com|pra|para) (voces|vcs|a kerosolar|sua empresa)|tem vaga|tem vagas|vaga de|vagas de|curriculo|oportunidade de (trabalho|emprego)|me candidatar)\b/.test(t)) return true
  return false
}

export function textoProfissional(saudacao: string): string {
  return `${saudacao}! Obrigada pelo contato e pelo interesse em trabalhar com a KeroSolar 😊 Seu contato foi salvo e vai ficar no nosso cadastro de profissionais. Quando surgir uma oportunidade, a nossa equipe entra em contato com você. Abraço! 👋`
}
