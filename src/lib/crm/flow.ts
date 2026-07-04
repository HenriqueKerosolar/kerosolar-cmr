import 'server-only'
import { prisma } from '@/lib/prisma'

type FlowMsg = { text: string; delaySeconds: number; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document' }
type StageFlow = {
  openingMessages: FlowMsg[]
  handoffToAi: boolean
  keywordRules?: { keywords: string; targetStageId: string }[]
  noReplyMinutes?: number
  noReplyTargetStageId?: string
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Envia uma mensagem de alerta para o dono/responsável via WhatsApp (Cloud API).
 * O número é lido de SystemConfig{ key: 'alert_phone' } — ex.: "5521999999999".
 * Se não configurado ou sem Cloud API, apenas loga e não falha.
 */
export async function notificarDono(mensagem: string): Promise<void> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'alert_phone' } })
    if (!cfg?.value) return
    const cloudAccount = await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
    if (!cloudAccount?.cloudPhoneNumberId) return
    const { sendCloudText } = await import('./cloud-api')
    await sendCloudText(cloudAccount.cloudPhoneNumberId, cfg.value, mensagem)
  } catch (e) {
    console.error('[notificarDono]', e)
  }
}

/**
 * Verifica se a mensagem do cliente contém alguma palavra-chave (ou variação)
 * configurada na etapa atual. Retorna a etapa de destino, se houver.
 */
export async function keywordTargetFor(stageId: string, text: string): Promise<string | null> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  const flow = stage?.flow as StageFlow | null
  if (!flow?.keywordRules?.length) return null
  const t = normalize(text)
  for (const rule of flow.keywordRules) {
    if (!rule.targetStageId) continue
    const words = rule.keywords.split(',').map((w) => normalize(w.trim())).filter(Boolean)
    if (words.some((w) => w.length >= 2 && t.includes(w))) return rule.targetStageId
  }
  return null
}

/** Move o lead para uma etapa (uso por palavra-chave / manual), disparando a chamada. */
export async function moveLeadToStage(leadId: string, targetStageId: string, reason: string) {
  const target = await prisma.stage.findUnique({ where: { id: targetStageId } })
  if (!target) return
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({ data: { leadId, type: 'stage_change', content: reason } })
  await enterStage(leadId, target.id).catch(() => {})
}

/**
 * Envia uma mensagem de saída: grava no histórico e despacha pro canal
 * (WhatsApp via Baileys, ou nada no simulador — só fica registrado).
 */
export async function dispatchOutbound(
  conversationId: string,
  text: string,
  media?: { url: string; type: 'image' | 'video' | 'document' | 'audio' },
  senderType: 'system' | 'human' | 'ai' = 'system',
  senderUserId?: string,
  skipDedup = false,   // simulações que o cliente pede de novo podem repetir o mesmo texto
  templateActionType?: string, // se informado, usa template aprovado como fallback quando janela 24h fecha
) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } })
  if (!conv) return

  // 🔒 Anti-repetição (regra universal: nunca repetir mensagem). Mensagens automáticas
  // (ai/system) NÃO são reenviadas se forem idênticas à última que NÓS mandamos nesta
  // conversa — evita follow-up/saudação duplicados e loop da IA. (Humano pode repetir.)
  if (text && !media && !skipDedup && (senderType === 'ai' || senderType === 'system')) {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const lastOut = await prisma.message.findFirst({
      where: { conversationId, direction: 'outbound', senderType: { in: ['ai', 'system'] } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    if (lastOut && norm(lastOut.content) === norm(text)) {
      console.warn('[flow dispatch] mensagem repetida bloqueada:', text.slice(0, 60))
      return
    }
  }

  const createdMsg = await prisma.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      senderType,
      senderUserId: senderUserId ?? null,
      content: text || (media ? '[mídia]' : ''),
      mediaUrl: media?.url ?? null,
      mediaType: media?.type ?? null,
    },
  })
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } })

  // Despacha pro canal de origem
  try {
    if (conv.channel === 'whatsapp' && conv.accountId) {
      const account = await prisma.whatsappAccount.findUnique({ where: { id: conv.accountId } })
      // Prioridade: Cloud API (oficial). Se a conta vinculada à conversa for Baileys, ainda assim
      // procura uma conta cloud disponível — isso garante que conversas antigas (criadas quando o
      // sistema usava Baileys) continuem funcionando após a migração para Cloud API.
      const cloudAccount = (account?.provider === 'cloud' && account.cloudPhoneNumberId)
        ? account
        : await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
      if (cloudAccount?.cloudPhoneNumberId) {
        // 📲 API OFICIAL (Meta Cloud): envia pelo número do contato (a Cloud API não usa JID).
        const toPhone = conv.contact?.whatsappId || conv.contact?.phone || conv.externalId || ''
        if (toPhone) {
          const cloud = await import('./cloud-api')
          let waId: string | null = null
          try {
            waId = media
              ? await cloud.sendCloudMedia(cloudAccount.cloudPhoneNumberId, toPhone, media.url, media.type, text)
              : await cloud.sendCloudText(cloudAccount.cloudPhoneNumberId, toPhone, text)
          } catch (sendErr) {
            // Janela de 24h fechada → tenta template configurado para este tipo de ação
            if (sendErr instanceof cloud.CloudApiError && sendErr.is24hWindow && templateActionType) {
              const tmpl = await prisma.whatsappTemplate.findFirst({
                where: { actionType: templateActionType, metaStatus: 'APPROVED' },
              })
              if (tmpl) {
                // Injeta o primeiro nome do lead como {{1}} se o template usa variável
                const lead = conv.leadId
                  ? await prisma.lead.findUnique({ where: { id: conv.leadId }, include: { contact: true } })
                  : null
                const firstName = lead?.contact?.name?.split(' ')[0] || 'Cliente'
                const components = tmpl.bodyText.includes('{{1}}')
                  ? [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]
                  : []
                waId = await cloud.sendCloudTemplate(cloudAccount.cloudPhoneNumberId, toPhone, tmpl.name, tmpl.language, components)
                console.log(`[flow dispatch] janela 24h fechada — enviou template "${tmpl.name}" para ${toPhone}`)
              } else {
                console.warn(`[flow dispatch] janela 24h fechada e nenhum template APPROVED para "${templateActionType}" — mensagem não enviada`)
                await prisma.message.update({ where: { id: createdMsg.id }, data: { failedReason: 'janela_24h_sem_template' } }).catch(() => {})
              }
            } else {
              throw sendErr // re-lança para o catch externo enfileirar redeliver
            }
          }
          if (waId) await prisma.message.update({ where: { id: createdMsg.id }, data: { externalId: waId } }).catch(() => {})
        }
      } else if (conv.chatJid || conv.contact?.whatsappId) {
        // 🟢 BAILEYS (não-oficial): fallback quando não há conta cloud configurada.
        const wa = await import('./whatsapp')
        const jid = (conv.chatJid && conv.chatJid.includes('@')) ? conv.chatJid : conv.contact!.whatsappId!
        const waId = media
          ? await wa.sendMedia(conv.accountId, jid, { url: media.url, type: media.type === 'audio' ? 'document' : media.type, caption: text })
          : await wa.sendText(conv.accountId, jid, text)
        // guarda o ID do WhatsApp na mensagem pra casar com o recibo de leitura (✓✓ azul)
        if (waId) await prisma.message.update({ where: { id: createdMsg.id }, data: { externalId: waId } }).catch(() => {})
      }
    } else if (conv.channel === 'facebook' || conv.channel === 'instagram') {
      const meta = await import('./meta')
      const recipient = conv.channel === 'facebook' ? conv.contact?.facebookId : conv.contact?.instagramId
      if (recipient) {
        if (media) await meta.sendMetaMedia(conv.channel, recipient, media.url, (media.type === 'document' || media.type === 'audio') ? 'file' : media.type)
        else if (text) await meta.sendMetaMessage(conv.channel, recipient, text)
      }
    }
  } catch (e) {
    console.error('[flow dispatch]', e)
    // 🔁 Envio falhou (ex.: WhatsApp reiniciando/caído). NÃO perde a mensagem: re-enfileira
    // pra reentregar quando a conexão voltar — sem criar nova mensagem no chat (não duplica).
    if (conv.channel === 'whatsapp' && conv.leadId) {
      await prisma.scheduledAction.create({
        data: {
          leadId: conv.leadId, conversationId, stageId: null, type: 'redeliver',
          // messageId: referência ao registro já criado no DB. O handler de redeliver verifica
          // se a mensagem já tem externalId (= WA confirmou entrega) — se sim, pula o reenvio
          // para evitar mensagem duplicada quando o socket caiu APÓS o envio já ter ocorrido.
          payload: { text, mediaUrl: media?.url ?? null, mediaType: media?.type ?? null, attempts: 0, messageId: createdMsg.id } as object,
          runAt: new Date(Date.now() + 30000),
        },
      }).catch(() => {})
    }
  }
}

/**
 * Dispara a "chamada" da etapa quando um lead ENTRA nela.
 * Mensagens com delay 0 saem na hora; as demais ficam agendadas.
 */
export async function enterStage(leadId: string, stageId: string) {
  // 🧹 Ao ENTRAR numa etapa, cancela as automações PENDENTES das OUTRAS etapas (etapas anteriores
  //    não "carregam" sua automação pra cá). Mantém só as da etapa atual (que serão (re)armadas
  //    abaixo). Roda sempre, mesmo se a etapa nova não tiver bot.
  await prisma.scheduledAction.updateMany({
    where: {
      leadId, done: false, stageId: { not: stageId },
      type: { in: ['flow_noreply', 'flow_continue', 'no_reply', 'chegada_followup', 'ac_followup', 'after_hours_resume', 'reengage', 'budget_followup', 'budget_validity'] },
    },
    data: { done: true },
  }).catch(() => {})

  // IA pausada (operador assumiu → aiEnabled=false) OU cliente recusou bot (humanOnly) →
  // nenhuma automação dispara, INCLUSIVE a mensagem de abertura da etapa. Mover de etapa com a
  // IA desligada NÃO pode fazer o bot voltar a mandar mensagem (ex.: recepção de "Já é cliente").
  const leadCheck = await prisma.lead.findUnique({ where: { id: leadId }, select: { humanOnly: true, aiEnabled: true } })
  if (leadCheck?.humanOnly || leadCheck?.aiEnabled === false) return

  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  if (!stage || !stage.botEnabled) return
  const flow = stage.flow as (StageFlow & { blocks?: unknown[] }) | null
  if (!flow) return

  const conv = await prisma.conversation.findFirst({
    where: { leadId }, orderBy: { lastMessageAt: 'desc' },
  })
  if (!conv) return

  const isSimulator = conv.channel === 'simulator'

  // 🔁 REPESCAGEM e a escada "X DIAS DEPOIS": gera uma mensagem de reengajamento
  //    PERSONALIZADA (IA, com base na etapa de origem + contexto da conversa) tentando trazer
  //    o cliente de volta. Repescagem dispara na hora; "15 dias depois" espera 15 dias, etc.
  //    Depois, sem resposta em 24h, segue pra próxima etapa da escada (noReply da etapa).
  {
    const isRepescagem = /repescagem/i.test(stage.name)
    const diasMatch = stage.name.match(/(\d+)\s*dias?\s*depois/i)
    if (!isSimulator && (isRepescagem || diasMatch)) {
      const dias = diasMatch ? parseInt(diasMatch[1], 10) : 0
      // ⚠️ CONFORMIDADE META: etapas de 90d/180d só disparam se o lead JÁ respondeu ao menos
      // uma vez. Enviar mensagem após 90+ dias para quem nunca respondeu é considerado spam
      // pela Meta e pode resultar em banimento do número.
      if (dias >= 90) {
        const jaRespondeu = await prisma.message.count({ where: { conversationId: conv.id, direction: 'inbound' } })
        if (!jaRespondeu) {
          console.log(`[flow enterStage] ${dias}d: lead nunca respondeu — automação bloqueada por conformidade Meta`)
          return
        }
      }
      // 🕒 A régua conta a partir do ORÇAMENTO: "15 dias depois" = 15 dias APÓS o orçamento
      //    (datas fixas, não acumuladas). Âncora = 1ª mensagem do orçamento ("Sistema completo");
      //    fallback = criação do lead. Repescagem (dias=0) dispara na hora.
      let alvo = Date.now()
      if (dias > 0) {
        const orc = await prisma.message.findFirst({
          where: { conversationId: conv.id, direction: 'outbound', content: { contains: 'Sistema completo' } },
          orderBy: { createdAt: 'asc' }, select: { createdAt: true },
        })
        const base = orc?.createdAt ?? (await prisma.lead.findUnique({ where: { id: leadId }, select: { createdAt: true } }))?.createdAt
        alvo = (base ? new Date(base).getTime() : Date.now()) + dias * 24 * 60 * 60 * 1000
      }
      // Se a data-alvo já passou (lead chegou atrasado na etapa), dispara logo — nunca no passado.
      const runAt = new Date(Math.max(alvo, Date.now() + 60 * 1000))
      // O reengajamento SUBSTITUI o lembrete de orçamento → cancela pendências pra não enviar
      //    duas mensagens "no mesmo sentido" (validade/follow-up + repescagem) ao mesmo tempo.
      await prisma.scheduledAction.updateMany({ where: { leadId, type: { in: ['reengage', 'budget_validity', 'budget_followup'] }, done: false }, data: { done: true } })
      await prisma.scheduledAction.create({
        data: { leadId, conversationId: conv.id, stageId, type: 'reengage', payload: {} as object, runAt },
      }).catch(() => {})
      return
    }
  }

  // 📅 Etapas de ORÇAMENTO: agenda o lembrete de validade (1 dia depois) — "orçamento válido
  //    por 3 dias". Vale pras duas etapas ("Recebeu orçamento automático" e "...manual").
  if (!isSimulator && /or[çc]amento/i.test(stage.name)) {
    await prisma.scheduledAction.updateMany({ where: { leadId, type: 'budget_validity', done: false }, data: { done: true } })
    await prisma.scheduledAction.create({
      data: { leadId, conversationId: conv.id, stageId, type: 'budget_validity', payload: {} as object, runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    }).catch(() => {})
  }

  // Se a etapa usa o construtor de BLOCOS, executa o fluxo de blocos e encerra aqui.
  if (flow.blocks && flow.blocks.length) {
    const { startBlockFlow } = await import('./flow-blocks')
    await startBlockFlow(leadId, conv.id, stageId, isSimulator)
    return
  }

  // Cancela checagens de inatividade antigas (de outra etapa)
  await prisma.scheduledAction.updateMany({
    where: { leadId, type: 'no_reply', done: false }, data: { done: true },
  })

  // contato (para personalização {nome})
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  const nome = lead?.contact?.name?.split(' ')[0] ?? ''

  const { nextAllowedSlot, respeitaHorarioGlobal, tempoDigitacaoMs, janelaDoFunil } = await import('./schedule-window')
  const pipe = await prisma.pipeline.findUnique({ where: { id: stage.pipelineId }, select: { sendStartHour: true, sendEndHour: true } })
  const janela = janelaDoFunil(pipe?.sendStartHour, pipe?.sendEndHour)
  let cursor = Date.now()
  for (const m of flow.openingMessages ?? []) {
    const text = (m.text || '').replace(/\{nome\}/gi, nome)
    const media = m.mediaUrl ? { url: m.mediaUrl, type: m.mediaType ?? 'image' } : undefined
    // espaçamento humano (delay configurado + tempo de digitação) dentro da janela permitida
    cursor += (m.delaySeconds || 0) * 1000 + tempoDigitacaoMs(text)
    const sendAt = nextAllowedSlot(respeitaHorarioGlobal(new Date(cursor)), janela)
    cursor = sendAt.getTime()
    if (isSimulator || sendAt.getTime() <= Date.now() + 1500) {
      await dispatchOutbound(conv.id, text, media)
    } else {
      await prisma.scheduledAction.create({
        data: {
          leadId, conversationId: conv.id, stageId,
          type: 'send_message',
          payload: { text, mediaUrl: media?.url, mediaType: media?.type } as object,
          runAt: sendAt,
        },
      })
    }
  }

  // ⏱️ Mudança automática por inatividade: agenda checagem após a chamada + X min (não no simulador)
  if (!isSimulator && flow.noReplyMinutes && flow.noReplyMinutes > 0 && flow.noReplyTargetStageId) {
    await prisma.scheduledAction.create({
      data: {
        leadId, conversationId: conv.id, stageId,
        type: 'no_reply',
        payload: { fromStageId: stageId, targetStageId: flow.noReplyTargetStageId } as object,
        runAt: new Date(cursor + flow.noReplyMinutes * 60 * 1000),
      },
    })
  }
}

/**
 * 👋 Saudação inicial para LEAD MANUAL.
 * Etapas como a "Chegada" não têm mensagens de abertura próprias — a saudação do primeiro
 * contato vem do MOTOR (engine), que só roda quando o cliente manda mensagem. Para um lead
 * cadastrado manualmente (que não escreveu nada), enviamos aqui a MESMA saudação de boas-vindas,
 * respeitando o horário comercial (fora do horário, agenda pro próximo horário válido).
 * Usada pelo cadastro manual quando a etapa não tem fluxo de abertura próprio.
 */
export async function iniciarSaudacaoManual(leadId: string, conversationId: string, stageId: string) {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } })
  if (!stage?.botEnabled) return

  // Saudação baseada na HORA REAL de agora (Brasília).
  const sendHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  const saud = sendHour < 12 ? 'Bom dia' : sendHour < 18 ? 'Boa tarde' : 'Boa noite'

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { contact: true } })
  const nome = lead?.contact?.name?.split(' ')[0] ?? ''
  // 🎯 Saudação dinâmica (teste A/B com aprendizado): escolhe a variação que mais faz o
  // cliente responder e contabiliza o envio. Marca a variação no lead pra medir a resposta.
  const { escolherSaudacao } = await import('./greeting')
  const { text: msg } = await escolherSaudacao(leadId, saud, nome)

  // 📤 Lead criado MANUALMENTE = ação deliberada do operador → envia AGORA, mesmo fora da
  //    janela 9h–18h. (O lead automático/inbound continua respeitando o horário comercial.)
  await dispatchOutbound(conversationId, msg, undefined, 'ai')
  const { scheduleNoReply } = await import('./flow-blocks')
  await scheduleNoReply(leadId, conversationId, stageId).catch(() => {})
}

/**
 * 🧮 COMANDO DO OPERADOR: "minha indicação é XXXX kWh" → calcula o orçamento por aquele consumo
 * e envia o orçamento formatado ao cliente (em vez de mandar o texto literal). Vale em QUALQUER
 * etapa e tanto pelo CRM quanto pelo app do WhatsApp. Aceita kwh/kw/k.
 * Retorna true se reconheceu e tratou o comando (aí NÃO se deve enviar/registrar o texto literal).
 */
export async function comandoIndicacaoKwh(leadId: string, conversationId: string, text: string): Promise<boolean> {
  // [^\d]{0,40}: tolera frases naturais entre "indicação" e o número, ex.: "minha indicação é de
  // um kit de 700 kWh" (o trecho " é de um kit de " sozinho já tem 16 chars — o limite antigo de 15 barrava).
  const ind = (text || '').match(/\b(?:minha\s+)?(?:indica[çc][aã]o|indico)\b[^\d]{0,40}([\d.,]+)\s*(?:kwh|kw|k)\b/i)
  if (!ind) return false
  const raw = ind[1].includes(',') ? ind[1].replace(/\./g, '').replace(',', '.')
    : (/^\d{1,3}(\.\d{3})+$/.test(ind[1]) ? ind[1].replace(/\./g, '') : ind[1])
  const kwh = Math.round(parseFloat(raw) || 0)
  const { calcularSolarPorKwh, orcamentoTexto, carregarTabelaFinanciamento, consumoKwhValido } = await import('./solar-calc')
  if (!consumoKwhValido(kwh)) return false   // fora da faixa realista → não trata (manda texto normal)
  await carregarTabelaFinanciamento()
  const solar = calcularSolarPorKwh(kwh)
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
  await prisma.lead.update({ where: { id: leadId }, data: {
    customFields: { ...cf, solar, consumoKwh: solar.consumoKwh, billValue: solar.contaReais } as object,
    value: solar.valorSistema, lastMessageAt: new Date(),
  } }).catch(() => {})
  await dispatchOutbound(conversationId, orcamentoTexto(solar), undefined, 'ai')
  await prisma.note.create({ data: { leadId, type: 'system', content: `Operador indicou ${kwh} kWh → orçamento enviado (sistema R$ ${solar.valorSistema.toLocaleString('pt-BR')}).` } }).catch(() => {})
  // Enviou orçamento → move pra etapa "Recebeu orçamento automático" (se ainda não estiver lá).
  const alvo = await prisma.stage.findFirst({ where: { name: { contains: 'Recebeu orçamento autom', mode: 'insensitive' } } })
  const ld = await prisma.lead.findUnique({ where: { id: leadId }, select: { stageId: true } })
  if (alvo && ld && ld.stageId !== alvo.id) {
    await moveLeadToStage(leadId, alvo.id, 'Operador enviou orçamento (indicação) — movido para "Recebeu orçamento automático".').catch(() => {})
  }
  return true
}

/**
 * 📣 DISPARO EM MASSA por TEMPLATE (API oficial). Envia um template aprovado pra TODOS os contatos
 *    de WhatsApp, espaçando os envios (anti-flood/rate-limit) e respeitando a lista de opt-out.
 *    Se o template ainda não estiver APROVADO pela Meta, reagenda +1h (tenta de novo depois).
 *    payload: { templateName, lang? }
 */
async function enviarBroadcastTemplate(a: { id: string; payload: unknown }): Promise<{ rescheduled?: boolean } | void> {
  const pl = (a.payload as { templateName?: string; lang?: string }) ?? {}
  if (!pl.templateName) return
  const account = await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
  if (!account?.cloudPhoneNumberId) { console.error('[broadcast] sem conta cloud configurada'); return }
  const { sendCloudTemplate } = await import('./cloud-api')
  const { numeroNaLista } = await import('./lists')

  // 1) Só dispara se o template já foi APROVADO pela Meta. Senão, reagenda +1h e tenta de novo.
  try {
    if (account.cloudWabaId && process.env.WHATSAPP_CLOUD_TOKEN) {
      const res = await fetch(`https://graph.facebook.com/v23.0/${account.cloudWabaId}/message_templates?name=${pl.templateName}&access_token=${process.env.WHATSAPP_CLOUD_TOKEN}`)
      const d = await res.json() as { data?: Array<{ status?: string }> }
      const st = d?.data?.[0]?.status
      if (st && st !== 'APPROVED') {
        console.log(`[broadcast] template "${pl.templateName}" está ${st} (não aprovado) — reagendando +1h`)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: new Date(Date.now() + 60 * 60 * 1000) } }).catch(() => {})
        return { rescheduled: true }
      }
    }
  } catch (e) { console.error('[broadcast] erro checando aprovação (segue):', e) }

  // 2) Alvos: todas as conversas de whatsapp com telefone, exceto quem está na lista de não-receber.
  const convs = await prisma.conversation.findMany({ where: { channel: 'whatsapp' }, include: { contact: true } })
  let ok = 0, fail = 0, skip = 0
  for (const c of convs) {
    const phone = c.contact?.whatsappId || c.contact?.phone
    if (!phone) { skip++; continue }
    try { if (await numeroNaLista(phone, 'no_receive')) { skip++; continue } } catch { /* segue */ }
    try {
      const id = await sendCloudTemplate(account.cloudPhoneNumberId, phone, pl.templateName, pl.lang || 'pt_BR')
      if (id) {
        ok++
        await prisma.message.create({ data: { conversationId: c.id, direction: 'outbound', senderType: 'ai', content: '📣 Mensagem de retomada de atendimento (disparo em massa).', externalId: id } }).catch(() => {})
        await prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } }).catch(() => {})
      } else fail++
    } catch { fail++ }
    await new Promise((r) => setTimeout(r, 1500)) // espaça ~1,5s por envio (anti-flood)
  }
  console.log(`[broadcast] template "${pl.templateName}": ${ok} enviados, ${fail} falhas, ${skip} pulados (de ${convs.length} conversas)`)
}

/** Processa as ações agendadas vencidas. Chamado pelo poller. */
export async function processDueActions() {
  const due = await prisma.scheduledAction.findMany({
    where: { done: false, runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' }, take: 20,
  })
  const { nextAllowedSlot, respeitaHorarioGlobal, tempoDigitacaoMs, janelaDoFunil } = await import('./schedule-window')
  let cursor = Date.now()   // garante espaçamento entre envios desta rodada

  // Tipos de NUDGE automático da IA. Se a IA estiver pausada no lead (operador assumiu) ou for
  // atendimento humano, NENHUM desses dispara — evita cobrança/follow-up no meio de uma
  // negociação que você assumiu.
  const NUDGE_TYPES = new Set(['flow_continue', 'flow_noreply', 'budget_followup', 'budget_validity', 'reengage', 'chegada_followup', 'after_hours_resume', 'no_reply', 'ac_followup'])

  for (const a of due) {
    try {
      // 🤖 IA pausada no lead (aiEnabled=false → operador assumiu) ou humanOnly → cancela o nudge.
      if (NUDGE_TYPES.has(a.type)) {
        const ld = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { aiEnabled: true, humanOnly: true } })
        if (ld && (!ld.aiEnabled || ld.humanOnly)) {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
          continue
        }
        // 🔒 Conversa ENCERRADA pelo atendente (resolvedAt) → automação não reabre.
        //    Só volta quando o cliente escrever (o motor zera o resolvedAt no inbound).
        if (a.conversationId) {
          const cv = await prisma.conversation.findUnique({ where: { id: a.conversationId }, select: { resolvedAt: true } })
          if (cv?.resolvedAt) {
            await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
            continue
          }
        }
      }

      // ⏰ Mensagens automáticas ENTRE ETAPAS só saem em HORÁRIO COMERCIAL (dia útil + janela
      //    do funil). Se a ação vencer fora do horário, reagenda pro próximo horário válido
      //    (ex.: 9h do próximo dia útil) em vez de mandar de madrugada/fim de semana.
      if (a.type === 'flow_continue' || a.type === 'flow_noreply' || a.type === 'budget_followup' || a.type === 'budget_validity' || a.type === 'reengage' || a.type === 'chegada_followup' || a.type === 'after_hours_resume' || a.type === 'no_reply' || a.type === 'ac_followup') {
        const ldw = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { pipeline: { select: { sendStartHour: true, sendEndHour: true } } } })
        const janela = janelaDoFunil(ldw?.pipeline?.sendStartHour, ldw?.pipeline?.sendEndHour)
        const slot = nextAllowedSlot(respeitaHorarioGlobal(new Date()), janela)
        if (slot.getTime() > Date.now() + 2000) {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: slot } })
          continue
        }
      }
      if (a.type === 'no_reply') {
        await handleNoReply(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'ac_followup') {
        await handleAcFollowup(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'broadcast_template') {
        const res = await enviarBroadcastTemplate(a)
        if (!res?.rescheduled) await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'flow_continue') {
        const pl = (a.payload as { stageId?: string; index?: number }) ?? {}
        if (pl.stageId && typeof pl.index === 'number') {
          const { resumeAfterWait } = await import('./flow-blocks')
          await resumeAfterWait(a.conversationId, a.leadId, pl.stageId, pl.index)
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'flow_noreply') {
        const { handleFlowNoReply } = await import('./flow-blocks')
        await handleFlowNoReply(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'budget_followup') {
        await handleBudgetFollowup(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'appointment_reminder') {
        await handleAppointmentReminder(a)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      // 🔁 Reentrega de mensagem que falhou (WhatsApp estava caído). NÃO cria nova mensagem
      // no chat — só reenvia o texto/mídia. Tenta a cada 1 min por ~20 min; depois desiste.
      if (a.type === 'redeliver') {
        const p = (a.payload as { text?: string; mediaUrl?: string | null; mediaType?: 'image' | 'video' | 'document' | null; attempts?: number; messageId?: string }) ?? {}
        const attempts = p.attempts ?? 0

        // 🛡️ Anti-duplicata: antes de reenviar, verifica se a mensagem original já tem
        // externalId (= WA confirmou o envio na primeira tentativa, mesmo que o socket tenha
        // caído logo depois). Se sim, o envio JÁ OCORREU — só marca como concluído.
        if (p.messageId) {
          const original = await prisma.message.findUnique({ where: { id: p.messageId }, select: { externalId: true } }).catch(() => null)
          if (original?.externalId) {
            console.log('[redeliver] externalId já presente — mensagem entregue, pulando reenvio')
            await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
            continue
          }
        }

        const conv = await prisma.conversation.findUnique({ where: { id: a.conversationId }, include: { contact: true } })
        let ok = false
        let waId: string | null = null
        try {
          if (conv?.channel === 'whatsapp' && conv.accountId) {
            const account = await prisma.whatsappAccount.findUnique({ where: { id: conv.accountId } })
            const cloudAccount = (account?.provider === 'cloud' && account.cloudPhoneNumberId)
              ? account
              : await prisma.whatsappAccount.findFirst({ where: { provider: 'cloud', cloudPhoneNumberId: { not: null } } })
            if (cloudAccount?.cloudPhoneNumberId) {
              const toPhone = conv.contact?.whatsappId || conv.contact?.phone || conv.externalId || ''
              if (toPhone) {
                const cloud = await import('./cloud-api')
                if (p.mediaUrl) waId = await cloud.sendCloudMedia(cloudAccount.cloudPhoneNumberId, toPhone, p.mediaUrl, p.mediaType ?? 'image', p.text)
                else if (p.text) waId = await cloud.sendCloudText(cloudAccount.cloudPhoneNumberId, toPhone, p.text)
                ok = true
              }
            } else if (conv.contact?.whatsappId) {
              const wa = await import('./whatsapp')
              const jid = conv.contact.whatsappId
              if (p.mediaUrl) waId = await wa.sendMedia(conv.accountId, jid, { url: p.mediaUrl, type: p.mediaType ?? 'image', caption: p.text })
              else if (p.text) waId = await wa.sendText(conv.accountId, jid, p.text)
              ok = true
            }
          }
        } catch { ok = false }
        // Após reentrega bem-sucedida, salva o externalId para evitar futuros redeliveries
        if (ok && waId && p.messageId) {
          await prisma.message.update({ where: { id: p.messageId }, data: { externalId: waId } }).catch(() => {})
        }
        if (ok || attempts >= 20) {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        } else {
          await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: new Date(Date.now() + 60000), payload: { ...p, attempts: attempts + 1 } as object } }).catch(() => {})
        }
        continue
      }
      if (a.type === 'budget_validity') {
        const ldv = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { humanOnly: true, status: true } })
        if (ldv && !ldv.humanOnly && ldv.status === 'open') {
          const cfg = await prisma.systemConfig.findUnique({ where: { key: 'budget_validity_message' } })
          const spHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
          const saud = spHour < 12 ? 'Bom dia' : spHour < 18 ? 'Boa tarde' : 'Boa noite'
          const msg = (cfg?.value || DEFAULT_BUDGET_VALIDITY).replace(/\{SAUDACAO\}/g, saud)
          await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'chegada_followup') {
        const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, include: { contact: true } })
        const stage = lead ? await prisma.stage.findUnique({ where: { id: lead.stageId } }) : null
        const cf = (lead?.customFields as Record<string, unknown> | null) ?? {}
        const step = (a.payload as { step?: number })?.step ?? 1
        // respondeu depois de armar? mudou de etapa? já tem orçamento? humano assumiu? → não aplica
        const inboundDepois = await prisma.message.count({ where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } } })
        const naChegada = /chegada/i.test(stage?.name ?? '')
        const aplica = lead && !lead.humanOnly && lead.aiEnabled && naChegada && inboundDepois === 0 && !cf.solar && !cf.billValue && !cf.consumoKwh
        if (aplica) {
          if (step === 1) {
            const nome = lead.contact?.name?.split(' ')[0] ?? ''
            const msg = `${nome ? nome + ', ' : ''}quer que eu já prepare seu orçamento? 😊 É só me mandar a foto da sua conta de luz, ou me dizer seu consumo médio em kWh ou o valor médio da conta.\n\n_Para não receber mais mensagens, responda PARAR._`
            await dispatchOutbound(a.conversationId, msg, undefined, 'ai', undefined, false, 'chegada_followup')
            await prisma.scheduledAction.create({ data: { leadId: a.leadId, conversationId: a.conversationId, stageId: a.stageId, type: 'chegada_followup', payload: { step: 2 } as object, runAt: new Date(Date.now() + 2 * 60 * 60 * 1000) } }).catch(() => {})
          } else {
            const target = await prisma.stage.findFirst({ where: { name: { equals: 'Repescagem', mode: 'insensitive' } } })
            if (target) await moveLeadToStage(a.leadId, target.id, 'Conversou na Chegada mas não avançou — movido para Repescagem.')
          }
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'after_hours_resume') {
        // 🌅 Retomada do horário comercial: o lead recebeu o "agora ou depois?" fora do horário
        //    e NÃO respondeu. Agora (9h+) a IA retoma o atendimento — cumprindo a promessa.
        //    Só aplica se: IA ligada, não é atendimento humano, lead aberto e o cliente
        //    continua sem responder desde que o prompt foi enviado.
        const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, include: { contact: true } })
        const inboundDepois = await prisma.message.count({ where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } } })
        const aplica = lead && !lead.humanOnly && lead.aiEnabled && lead.status === 'open' && inboundDepois === 0
        if (aplica) {
          const spHour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
          const saud = spHour >= 5 && spHour < 12 ? 'Bom dia' : spHour >= 12 && spHour < 18 ? 'Boa tarde' : 'Boa noite'
          const nome = lead.contact?.name?.split(' ')[0] ?? ''
          const cfg = await prisma.systemConfig.findUnique({ where: { key: 'after_hours_resume_message' } })
          const msg = (cfg?.value || `${saud}${nome ? ', ' + nome : ''}! 😊 Retomando seu contato com a KeroSolar. Pra eu já preparar seu orçamento de energia solar, me envia a *foto da sua conta de luz* — ou me diz seu *consumo médio em kWh* ou o *valor médio da conta*. Qualquer uma já serve!`)
            .replace(/\{SAUDACAO\}/g, saud).replace(/\{nome\}/gi, nome)
          await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
          // limpa o estado de fora-de-horário e arma o nudge da Chegada (+2h → Repescagem)
          await prisma.lead.update({ where: { id: a.leadId }, data: { afterHoursAsked: false, afterHoursProceed: true } }).catch(() => {})
          await prisma.scheduledAction.create({ data: { leadId: a.leadId, conversationId: a.conversationId, stageId: a.stageId, type: 'chegada_followup', payload: { step: 1 } as object, runAt: new Date(Date.now() + 2 * 60 * 60 * 1000) } }).catch(() => {})
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'recalc_orcamento') {
        // 🧮 Disparo manual do orçamento: recalcula com o motor REAL (mesmos números do sistema)
        //    e envia o orçamento formatado pelo WhatsApp, gravando a simulação no lead.
        //    payload: { kwh?: number, reais?: number }
        const pl = (a.payload as { kwh?: number; reais?: number }) ?? {}
        const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
        if (lead && !lead.humanOnly) {
          const { calcularSolarPorKwh, calcularSolar, orcamentoTexto, carregarTabelaFinanciamento, consumoKwhValido, contaReaisValida } = await import('./solar-calc')
          await carregarTabelaFinanciamento()
          const solar = (typeof pl.kwh === 'number' && consumoKwhValido(pl.kwh)) ? calcularSolarPorKwh(pl.kwh)
                      : (typeof pl.reais === 'number' && contaReaisValida(pl.reais)) ? calcularSolar(pl.reais)
                      : null
          if (solar) {
            const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
            await prisma.lead.update({ where: { id: a.leadId }, data: {
              customFields: { ...cf, solar, consumoKwh: solar.consumoKwh, billValue: solar.contaReais } as object,
              value: solar.valorSistema,
            } }).catch(() => {})
            await dispatchOutbound(a.conversationId, orcamentoTexto(solar), undefined, 'ai')
          }
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type === 'reengage') {
        const ld = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { humanOnly: true, status: true } })
        if (ld && !ld.humanOnly && ld.status === 'open') {
          const { gerarMensagemReengajamento } = await import('./reengage')
          const msg = await gerarMensagemReengajamento(a.leadId, a.conversationId)
          if (msg) {
            await dispatchOutbound(a.conversationId, msg, undefined, 'ai', undefined, false, 'reengage')
            // Sem resposta após reengajamento → Leads adquiridos (não adianta continuar tentando)
            if (a.stageId) {
              const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { pipelineId: true, stageId: true } })
              const leadsAdq = lead ? await prisma.stage.findFirst({
                where: { name: { contains: 'adquiridos', mode: 'insensitive' }, pipelineId: lead.pipelineId },
              }) : null
              if (leadsAdq) {
                await prisma.scheduledAction.updateMany({ where: { leadId: a.leadId, type: { in: ['no_reply', 'flow_noreply'] }, done: false }, data: { done: true } }).catch(() => {})
                await prisma.scheduledAction.create({
                  data: {
                    leadId: a.leadId, conversationId: a.conversationId, stageId: a.stageId,
                    type: 'no_reply',
                    payload: { fromStageId: a.stageId, targetStageId: leadsAdq.id } as object,
                    runAt: new Date(Date.now() + 24 * 3600 * 1000),
                  },
                }).catch(() => {})
              } else {
                // fallback: usa configuração padrão da etapa
                const { scheduleNoReply } = await import('./flow-blocks')
                await scheduleNoReply(a.leadId, a.conversationId, a.stageId).catch(() => {})
              }
            }
          }
        }
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }
      if (a.type !== 'send_message') {
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
        continue
      }

      const p = (a.payload as { text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'document'; vary?: boolean }) ?? {}
      // Lead pediu bloqueio total? cancela
      const ld = await prisma.lead.findUnique({
        where: { id: a.leadId },
        select: { humanOnly: true, pipeline: { select: { sendStartHour: true, sendEndHour: true } } },
      })
      if (ld?.humanOnly) { await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }); continue }

      // Próximo horário válido (janela do funil + global), espaçado da mensagem anterior
      const janela = janelaDoFunil(ld?.pipeline?.sendStartHour, ld?.pipeline?.sendEndHour)
      const slot = nextAllowedSlot(respeitaHorarioGlobal(new Date(Math.max(Date.now(), cursor))), janela)
      if (slot.getTime() > Date.now() + 2000) {
        // fora da janela ou precisa espaçar → reagenda (NÃO marca done)
        await prisma.scheduledAction.update({ where: { id: a.id }, data: { runAt: slot } })
        cursor = slot.getTime() + tempoDigitacaoMs(p.text ?? '')
        continue
      }
      // dentro da janela e na vez → envia (se vary=true, gera uma VARIAÇÃO da mensagem por lead)
      let textoFinal = p.text ?? ''
      if (p.vary && textoFinal.trim()) {
        const { loadAiConfig, varyMessage } = await import('./ai')
        textoFinal = await varyMessage(await loadAiConfig(), textoFinal)
      }
      await dispatchOutbound(a.conversationId, textoFinal, p.mediaUrl ? { url: p.mediaUrl, type: p.mediaType ?? 'image' } : undefined)
      cursor = Date.now() + tempoDigitacaoMs(textoFinal)
      await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
    } catch (e) {
      console.error('[flow processDue]', e)
      await prisma.scheduledAction.update({ where: { id: a.id }, data: { done: true } }).catch(() => {})
    }
  }
}

const DEFAULT_BUDGET_FOLLOWUP =
  '{nome}, ficou com alguma dúvida sobre o orçamento? 😊 Se quiser um orçamento mais personalizado e preciso, ' +
  'posso agendar uma conversa com nosso Consultor especialista — em geral o valor fica ainda melhor! ' +
  'Quer que eu agende, ou prefere que eu te transfira agora para o Consultor?\n\n' +
  '_Para não receber mais mensagens, responda PARAR._'

// Lembrete de validade do orçamento — enviado 1 dia depois (configurável em system_configs: budget_validity_message)
const DEFAULT_BUDGET_VALIDITY =
  '{SAUDACAO}! Passando só pra lembrar 😊 Os orçamentos que enviamos ficam *ativos na nossa plataforma por 3 dias* ' +
  'a partir da data em que você recebeu. Depois disso eles saem do sistema e é preciso fazer uma *nova cotação* — ' +
  'e nesse novo pedido o valor pode mudar (por exemplo, se o modelo/marca não estiver mais disponível para cotação, ' +
  'ou por algum reajuste de preço). Se quiser seguir com a sua, é só me avisar que eu te ajudo! 🌞\n\n' +
  '_Para não receber mais mensagens, responda PARAR._'

/**
 * Follow-up do orçamento (~90s após o orçamento automático):
 * pergunta se ficou dúvida + oferece o consultor especialista.
 * O lead PERMANECE em "Recebeu orçamento automático" (não é movido) — daqui
 * ele segue para a régua de repescagem (15/30/60 dias) depois.
 * Cancelado automaticamente se o cliente responder (cancel-on-inbound no engine).
 */
async function handleBudgetFollowup(a: { leadId: string; conversationId: string; createdAt: Date; payload: unknown }) {
  const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, include: { contact: true } })
  if (!lead || lead.humanOnly || !lead.aiEnabled) return
  const inbound = await prisma.message.count({ where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } } })
  if (inbound > 0) return // cliente respondeu → não interrompe
  const step = (a.payload as { step?: number })?.step ?? 1
  if (step !== 1) return // passo 2 antigo (mover etapa) foi descontinuado — não faz nada

  const cfg = await prisma.systemConfig.findUnique({ where: { key: 'budget_followup_message' } })
  const nome = lead.contact?.name?.split(' ')[0] ?? ''
  const msg = (cfg?.value || DEFAULT_BUDGET_FOLLOWUP).replace(/\{nome\}/gi, nome)
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai', undefined, false, 'budget_followup')
}

/** Fallback de AC: cliente não informou as horas em 30 min → manda 2 orçamentos (sem AC e com AC 8h). */
async function handleAcFollowup(a: { leadId: string; conversationId: string; payload: unknown }) {
  const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
  if (!lead || lead.humanOnly) return
  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
  const ac = cf.ac as { units?: number; btu?: number; hoursPerDay?: number | null } | undefined
  if (!ac?.btu) return
  if (ac.hoursPerDay != null) return // cliente já informou as horas → não precisa do fallback

  const baseKwh = typeof cf.consumoKwh === 'number' ? cf.consumoKwh : null
  const { calcularSolarPorKwh, resumoParaIA, carregarTabelaFinanciamento } = await import('./solar-calc')
  await carregarTabelaFinanciamento()
  const { consumoAcKwhMes } = await import('./ac-calc')
  const acKwh = consumoAcKwhMes(ac.btu, 8, ac.units ?? 1)

  let msg: string
  if (baseKwh != null) {
    const semAc = calcularSolarPorKwh(baseKwh)
    const comAc = calcularSolarPorKwh(baseKwh + acKwh)
    msg = `Como não consegui as horas de uso, vou te passar duas opções 😊 (considerei *8h/dia*, que é a média de uso das pessoas):\n\n` +
      `*1) Sem o ar-condicionado* — sistema ${ 'R$ ' + semAc.valorSistema.toLocaleString('pt-BR') }\n${resumoParaIA(semAc)}\n\n` +
      `*2) Com o ar-condicionado* (+${acKwh} kWh/mês) — sistema ${ 'R$ ' + comAc.valorSistema.toLocaleString('pt-BR') }\n${resumoParaIA(comAc)}\n\n` +
      `Se me disser quantas horas por dia pretende usar, ajusto certinho!`
  } else {
    msg = `Sobre o ar-condicionado: considerando *8h/dia* (média de uso), ele acrescenta cerca de *${acKwh} kWh/mês* no consumo. ` +
      `Me manda sua conta de luz (ou o consumo médio) que eu já te passo o orçamento com e sem o ar 😊`
  }
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai')
  await prisma.note.create({ data: { leadId: a.leadId, type: 'system', content: 'AC: cliente não informou horas em 30 min — enviados orçamentos com/sem AC (8h padrão).' } })
}

/** Move o lead por inatividade — só se ele não respondeu e ainda está na etapa. */
async function handleNoReply(a: { id: string; leadId: string; conversationId: string; createdAt: Date; payload: unknown }) {
  const p = (a.payload as { fromStageId?: string; targetStageId?: string }) ?? {}
  if (!p.fromStageId || !p.targetStageId) return

  const lead = await prisma.lead.findUnique({ where: { id: a.leadId } })
  if (!lead || lead.stageId !== p.fromStageId) return // já mudou de etapa → ignora

  // Cliente respondeu depois que a checagem foi agendada? → não move
  const inbound = await prisma.message.count({
    where: { conversationId: a.conversationId, direction: 'inbound', createdAt: { gt: a.createdAt } },
  })
  if (inbound > 0) return

  const target = await prisma.stage.findUnique({ where: { id: p.targetStageId } })
  if (!target) return

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stageId: target.id,
      status: target.isWon ? 'won' : target.isLost ? 'lost' : 'open',
      closedAt: target.isWon || target.isLost ? new Date() : null,
    },
  })
  await prisma.note.create({
    data: { leadId: lead.id, type: 'stage_change', content: `Movido automaticamente para "${target.name}" por inatividade do cliente.` },
  })
  // dispara a chamada da nova etapa
  await enterStage(lead.id, target.id).catch(() => {})
}

/** Lembrete de agendamento: cria tarefa para o consultor + envia mensagem de confirmação ao cliente. */
async function handleAppointmentReminder(a: { leadId: string; conversationId: string; payload: unknown }) {
  const pl = (a.payload as { appointmentId?: string }) ?? {}
  if (!pl.appointmentId) return
  const appt = await prisma.appointment.findUnique({
    where: { id: pl.appointmentId },
    include: { lead: { include: { contact: true } } },
  })
  if (!appt || appt.status !== 'scheduled') return

  const channelLabel = appt.channel === 'phone' ? 'ligação' : appt.channel === 'video' ? 'videochamada' : appt.channel === 'visit' ? 'visita técnica' : 'conversa pelo WhatsApp'
  const channelIcon  = appt.channel === 'phone' ? '📞' : appt.channel === 'video' ? '🎥' : appt.channel === 'visit' ? '🏠' : '💬'
  const hora = appt.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const data = appt.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const nome = appt.lead.contact?.name?.split(' ')[0] ?? ''

  // 1) Tarefa de lembrete para o consultor
  const channelLabelTask = appt.channel === 'phone' ? 'Ligação' : appt.channel === 'video' ? 'Videochamada' : appt.channel === 'visit' ? 'Visita técnica' : 'WhatsApp'
  await prisma.task.create({
    data: {
      leadId: appt.leadId,
      title: `🔔 LEMBRETE: ${channelLabelTask} com ${appt.lead.contact?.name ?? appt.lead.title} às ${hora} (${data}) — confirmar com o cliente`,
      type: 'call',
      dueAt: appt.scheduledAt,
    },
  })

  // 2) Mensagem de confirmação ao cliente
  const saudacao = nome ? `${nome}, ` : ''
  const msg = `${channelIcon} ${saudacao}passando para confirmar nossa ${channelLabel} de hoje às *${hora}*. Você confirma? 😊`
  await dispatchOutbound(a.conversationId, msg, undefined, 'ai')

  // Guarda o ID do agendamento no lead para o agente saber que há confirmação pendente
  const cf = (appt.lead.customFields as Record<string, unknown> | null) ?? {}
  await prisma.lead.update({
    where: { id: appt.leadId },
    data: { customFields: { ...cf, pendingAppointmentId: appt.id, pendingAppointmentAt: appt.scheduledAt.toISOString() } as object },
  })

  await prisma.appointment.update({ where: { id: appt.id }, data: { remindedAt: new Date() } })
}

/** Inicia o poller único (sobrevive ao HMR via global). */
export function startScheduler() {
  const g = globalThis as unknown as { __crmScheduler?: NodeJS.Timeout; __crmSchedulerRunning?: boolean }
  if (g.__crmScheduler) return
  g.__crmScheduler = setInterval(() => {
    // Evita rodadas CONCORRENTES: se a anterior ainda está rodando (delays de digitação
    // podem passar de 15s), pula esta — senão duas rodadas processam a mesma ação e DUPLICAM.
    if (g.__crmSchedulerRunning) return
    g.__crmSchedulerRunning = true
    processDueActions().catch(() => {}).finally(() => { g.__crmSchedulerRunning = false })
  }, 15000)
}
