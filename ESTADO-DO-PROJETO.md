# KeroSolar CRM — Estado do Projeto

> Documentação viva do CRM. Atualizada em 2026-06-09.
> Objetivo: retomar o contexto rapidamente após limpar a conversa.

---

## 1. Visão geral

CRM omnichannel para energia solar (estilo Kommo), com **IA de atendimento**
(agente "Sol") que qualifica leads, calcula orçamento solar e agenda visitas.

- **Stack:** Next.js 16, Prisma 7, Supabase (Postgres), Baileys (WhatsApp Web), OpenAI/Anthropic (IA).
- **Hospedagem:** **Railway** (servidor persistente — obrigatório por causa do WhatsApp).
- **Repo:** GitHub `HenriqueKerosolar/kerosolar-cmr`.
- **URL produção:** https://kerosolar-crm-production.up.railway.app

### Por que Railway e não Vercel
O WhatsApp (Baileys) mantém uma **conexão WebSocket viva 24/7** e precisa de
**disco persistente** para as credenciais. O Vercel é serverless (processo morre
após cada request) → incompatível. O Railway tem processo contínuo + volume em `/data`.

---

## 2. Deploy

```bash
# Deploy direto (recomendado — não espera o GitHub):
railway up --service kerosolar-crm --detach

# Ver logs:
railway logs --service kerosolar-crm
```

- **⚠️ Cada deploy derruba o WhatsApp por ~3 min** (build + reconexão). Depois volta sozinho.
- O `build` roda `prisma generate && next build`. **Não** roda migrate nem seed.
- Variáveis em `railway variables --service kerosolar-crm`.

---

## 3. WhatsApp (Baileys)

Arquivo principal: `src/lib/crm/whatsapp.ts`.

- Sessões vivem no processo; credenciais salvas em **`/data/wa-sessions/<accountId>`** (volume persistente).
- **Reconexão automática no startup** (`reconnectAllOnStartup`): reconecta QUALQUER
  conta que tenha `creds.json` no disco, independente do status no banco.
- **Erro 515 (restartRequired) é NORMAL** — vem logo após gerar o QR/parear.
  Tratamento: reconectar em 1.5s **mantendo** as credenciais (NÃO apagar).
  Apagar credenciais só em logout real (401) ou connectionReplaced (440).
- **Dedup de mensagens** (evita resposta duplicada): por `msg.key.id` em memória +
  por `externalMessageId` no banco.
- **Proxy opcional** via env `PROXY_URL` (não usado atualmente — o IP do Railway funciona direto).

### Leitura de conta de luz (3 formatos)
- **📷 Foto/imagem** → `extractBillFromImage` (visão da IA) lê kWh, valor ou nº de painéis.
- **📄 PDF** → `unpdf` extrai o texto (NÃO usar pdftotext — não existe no Railway;
  NÃO usar pdf-parse — quebra o worker no bundle do Next). Depois `parseBillText`.
- **⌨️ Texto** → kWh, valor em R$, ou nº de painéis.

### Regras de cálculo
- **1 painel/placa/módulo = 60 kWh** (5 painéis = 300 kWh, 10 = 600 kWh...).
- **Equivalência kWh ↔ R$:** valor da conta ≈ kWh × 1,22.
- **Validação de faixa** (em `pdf-utils.ts`): consumo só 20–50.000 kWh; valor só
  R$ 30–100.000. Descarta código de barras/instalação que o PDF traz.

---

## 4. Agente de IA

Arquivos: `src/lib/crm/agent.ts` (prompt), `src/lib/crm/engine.ts` (orquestração).

### ⛔ REGRAS UNIVERSAIS — NUNCA QUEBRAR
Ficam no topo do `DEFAULT_SYSTEM` em `agent.ts`, acima de qualquer outra instrução,
e valem em qualquer etapa / qualquer lead:
1. **Nunca repetir uma mensagem** (nem a saudação nem qualquer texto já enviado).
2. **Nunca chutar valor quando não entender** a conta/consumo — não envia número
   nenhum, passa pro humano (`handoff: true`). Melhor não responder do que mandar valor errado.
3. **Sempre educado(a) e cortês** em qualquer situação, mesmo com cliente grosseiro.

- Prompt padrão em `DEFAULT_SYSTEM` (pode ser sobrescrito por `bot_prompt` no banco — hoje não há).
- **Consumo:** foto, kWh e R$ são EQUIVALENTES — qualquer um basta; nunca insistir na foto
  se já tem o consumo. Assume o valor (não pede confirmação do número).
- **Orçamento:** entregue na hora (determinístico via `orcamentoTexto`). Se o lead já tem
  orçamento salvo, a IA é avisada ("ESTE CLIENTE JÁ RECEBEU UM ORÇAMENTO") e nunca pede a conta de novo.
- **"quero financiar" NÃO é aceitação** — a IA explica/coleta dados. Aceitação só com
  termos explícitos (aceito, quero fechar, quero contratar, pode fechar...).

### Agendamento — VISITA vs ATENDIMENTO
- **VISITA TÉCNICA** = ida presencial ao endereço do cliente. `channel: "visit"`.
  **NUNCA perguntar canal.** Só dia e horário. (É o padrão para solar.)
- **ATENDIMENTO** = conversa remota com o consultor. Aí SIM pergunta WhatsApp/ligação/vídeo.
- **Dia não útil** (fim de semana/feriado): trava determinística `ehDiaUtil` (em `engine.ts`)
  IMPEDE gravar. A IA primeiro oferece trocar por dia útil; se insistir, escala ao consultor
  (highPriority) sem agendar.
- **Confirmação:** (1) na hora — repete o resumo e só grava após o cliente confirmar;
  (2) lembrete — 1 dia antes + 2h antes ("passando para confirmar... você confirma?").

---

## 5. Controles do CRM

- **Toggle IA por lead** (`lead-card-client.tsx`): botão "🤖 IA ativa · Desligar" /
  "👤 Manual · Ligar IA". Vale em qualquer etapa (todas as etapas têm IA ligada por padrão).
- **Anexar arquivo** no chat (📎): imagem/vídeo/PDF/doc/xls até 25 MB. Endpoint
  `POST /api/leads/[id]/send-media`; arquivos servidos por `GET /api/uploads/[name]`
  (salvos em `/data/uploads`).
- **Documentos recebidos do cliente** (foto/PDF) são salvos em `/data/uploads` e
  gravados como `mediaUrl` na mensagem → aparecem clicáveis no chat (imagem inline
  ou link "📎 Abrir arquivo"). Vale só para anexos recebidos a partir de 2026-06-09.
- **Nada é apagado quando o cliente apaga no WhatsApp.** Mídia recebida já está copiada
  no nosso servidor (persiste mesmo se o cliente apagar no celular dele). Quando o cliente
  faz "apagar para todos", o sistema NÃO remove a mensagem do banco — só prefixa o conteúdo
  com "🚫 (cliente apagou esta mensagem)" (tratamento de REVOKE no `handleIncoming`).
- **Blocos de tempo nas etapas:** seletor minuto/hora/dia (componente `TimeInput` em
  `stage-flow-builder.tsx`). Internamente sempre armazenado em **minutos**.
- **Scroll do chat:** auto-scroll só quando o operador já está perto do fim.
- **Mensagem de migração:** DESLIGADA em 2026-06-09 (config `migration_warning` apagada
  do `system_configs`). Não é mais enviada. Para religar, recriar a config com a mensagem.
- **Fora do horário (21h–06h):** quando o cliente escreve nesse intervalo, a IA pergunta
  se quer começar agora ou deixar registrado pro horário comercial (a partir das 9h).
  Entre 6h e 9h já atende normal. Lógica em `engine.ts` (`isAfterHours`).

### Lead manual
- Ao criar lead manual com telefone: vincula a conta de WhatsApp conectada (`accountId`)
  e normaliza o número com **DDI 55**. Sem isso a mensagem não vai pro WhatsApp.

---

## 6. Pendências / TODO

- [x] ~~Desativar a mensagem de migração~~ — FEITO em 2026-06-09.
- [ ] **WEBCHAT_ORIGIN** está `*` — restringir para `https://kerosolar.com.br`.
- [ ] **Scripts das etapas** foram perdidos (só "Chegada" tem). Recriar os scripts de IA
      por etapa se desejado (Funis → expandir etapa → "Script de IA desta etapa").
- [ ] Diretivas Sênior/Junior e Premia (afiliação) — planejadas, ainda não implementadas.

---

## 7. Gotchas (lembrar)

- **Não rodar `prisma migrate reset` / `db push --force-reset`** em produção — apaga dados
  (foi assim que os scripts de etapa se perderam em algum momento).
- O **status no banco** da conta WhatsApp pode ficar defasado do socket real; a fonte da
  verdade é a sessão em memória + `creds.json` no disco.
- Em deploys frequentes seguidos, o WhatsApp fica instável entre eles (cada um reinicia ~3 min).
- `pdftotext` e `pdf-parse` NÃO funcionam no Railway/Next — usar **`unpdf`**.

---

## 8. Credenciais (referência rápida)

- **Admin CRM:** `kerosolar@kerosolar.com.br`
- **DB (Supabase):** pooler `aws-1-sa-east-1.pooler.supabase.com` (ver `DATABASE_URL` no Railway).
- **Webchat (site):** endpoint `/api/public/webchat`, key `kerosolar-webchat-7Yq2Lp9XmZ`.

> Segredos completos estão nas variáveis do Railway — nunca commitar no git.
