# Integração: Conversions API da Meta (Clique-para-WhatsApp)

Objetivo: ligar cada **venda no CRM** de volta ao **anúncio** que gerou o clique, para que a campanha de **Vendas** no Meta otimize por eventos reais de qualidade (lead qualificado / compra) em vez de só "conversa iniciada".

Fluxo em uma frase: pessoa clica no anúncio → cai no WhatsApp → a Meta manda um `ctwa_clid` (carimbo do clique) na primeira mensagem → guardamos esse carimbo no contato → quando o lead vira venda, mandamos um evento `Purchase` de volta pra Meta com esse carimbo.

Tudo aqui é **aditivo** — não altera comportamento existente. Se as variáveis de ambiente não estiverem preenchidas, o rastreamento simplesmente não dispara (o CRM funciona igual).

---

## Parte 1 — Configuração no lado da Meta (Gerenciador de Eventos)

Isso é feito no navegador, uma vez. Você precisa de: (a) o **ID do conjunto de dados** (Dataset) e (b) um **token de acesso**.

1. Abra o **Gerenciador de Eventos** (business.facebook.com → Gerenciador de Eventos).
2. Localize (ou crie) o **conjunto de dados do WhatsApp**. Para contas que já rodam anúncios Clique-para-WhatsApp, a Meta normalmente **cria esse dataset automaticamente** e o conecta à sua conta WhatsApp Business (WABA). Se não existir: *Conectar fontes de dados → Conjunto de dados* e conecte-o à sua **WABA**.
3. Copie o **ID do conjunto de dados** (Dataset ID) — em *Configurações* do dataset.
4. Gere um **token de acesso da Conversions API**: dentro do dataset → *Configurações → Conversions API → Gerar token de acesso*.
   - Alternativa: usar o token do **Usuário do Sistema** que você já usa no `WHATSAPP_CLOUD_TOKEN`, desde que ele tenha as permissões `whatsapp_business_messaging`, `ads_management` e `business_management`. Se tiver, pode pular a geração e deixar `META_CAPI_TOKEN` vazio (o código cai no `WHATSAPP_CLOUD_TOKEN`).
5. Garanta que o dataset está **atribuído à sua conta de anúncios** (Configurações do Negócio → Fontes de dados → o dataset → Atribuir conta de anúncios).

Guarde o **Dataset ID** e o **token** para a Parte 3.

---

## Parte 2 — Alterações no código

### 2.1 Novo arquivo: `src/lib/crm/capi.ts`

Copie o arquivo `capi.ts` que acompanha este guia para `src/lib/crm/capi.ts`. Ele expõe uma única função, `sendCapiEvent(...)`, best-effort (nunca lança).

### 2.2 Schema do banco: guardar o `ctwa_clid` no contato

Em `prisma/schema.prisma`, no `model Contact`, adicione três campos (logo depois de `customFields Json?`):

```prisma
  // ── Atribuição de anúncio Clique-para-WhatsApp (CTWA) ──
  ctwaClid    String?   // referral.ctwa_clid — carimbo do clique no anúncio
  ctwaClidAt  DateTime? // quando capturamos (a janela de atribuição da Meta é ~7 dias)
  adReferral  Json?     // dados do anúncio de origem (source_id, source_url, headline...)
```

Depois rode a migração (com o banco acessível):

```bash
npx prisma migrate dev --name add_ctwa_attribution
# ou, no fluxo Supabase que vocês usam:
# npx prisma db push
```

### 2.3 Webhook: capturar o `referral`/`ctwa_clid`

Arquivo: `src/app/api/whatsapp/webhook/route.ts`.

**(a)** No type `WaMessage`, adicione o campo `referral` (é o objeto que a Meta manda na PRIMEIRA mensagem de quem veio de um anúncio):

```ts
type WaMessage = {
  from: string
  id: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  video?: { id: string; mime_type?: string; caption?: string }
  audio?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string; filename?: string; caption?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  // 🆕 CTWA: presente só na 1ª msg de quem clicou num anúncio clique-para-WhatsApp
  referral?: {
    ctwa_clid?: string
    source_id?: string      // ID do anúncio
    source_url?: string
    source_type?: string    // normalmente "ad"
    headline?: string
    body?: string
  }
}
```

**(b)** Passe o `cloudWabaId` da conta adiante. Hoje `processarMensagem` recebe `account` tipado como `{ id, cloudPhoneNumberId }`. Troque para incluir a WABA:

```ts
async function processarMensagem(
  m: WaMessage,
  account: { id: string; cloudPhoneNumberId: string | null; cloudWabaId: string | null },
  nome?: string,
) {
```

> `acharOuCriarConta` já retorna a linha inteira da conta, então `account.cloudWabaId` já existe em runtime — é só o tipo que precisa incluí-lo.

**(c)** Logo **depois** da chamada `const result = await ingestMessage({ ... })` (que cria/atualiza o contato e o lead), adicione o bloco que grava o carimbo e dispara o evento de conversa vinda de anúncio:

```ts
  // 🆕 CTWA: se a mensagem veio de um clique em anúncio, guarda o carimbo no contato
  // e avisa a Meta que o anúncio gerou uma conversa (sinal de topo de funil).
  const clid = m.referral?.ctwa_clid
  if (clid) {
    await prisma.contact.updateMany({
      where: { OR: [{ phone: from }, { whatsappId: from }] },
      data: {
        ctwaClid: clid,
        ctwaClidAt: new Date(),
        adReferral: {
          source_id: m.referral?.source_id ?? null,
          source_url: m.referral?.source_url ?? null,
          source_type: m.referral?.source_type ?? null,
          headline: m.referral?.headline ?? null,
          body: m.referral?.body ?? null,
        } as unknown as object,
      },
    }).catch(() => {})

    const { sendCapiEvent } = await import('@/lib/crm/capi')
    void sendCapiEvent({
      eventName: 'Lead',                       // conversa iniciada por anúncio
      ctwaClid: clid,
      wabaId: account.cloudWabaId,
      phone: from,
      eventId: `${from}:lead:${m.id ?? ''}`,   // dedup
    }).catch(() => {})
  }
```

> **Onde disparar o `Lead`?** Acima ele dispara na primeira conversa vinda de anúncio (bom volume para a Meta aprender). Se preferir um sinal mais "quente", mova esse `sendCapiEvent({ eventName: 'Lead', ... })` para o ponto do fluxo onde o lead é **qualificado** (ex.: quando o `billValue`/conta de luz é capturado em `customFields`). Para começar, deixe onde está — dá volume e depois refina.

### 2.4 Disparar `Purchase` quando o lead é ganho

Arquivo: `src/app/actions/lead.ts`, função `moveLeadStage`. Hoje ela marca `status: 'won'` quando a etapa é `isWon`. Adicione o disparo do evento de compra logo após o `prisma.lead.update({...})` e antes do `revalidatePath`:

```ts
  // 🆕 CTWA: venda ganha → manda Purchase pra Meta com o valor, ligado ao clique do anúncio.
  if (stage?.isWon) {
    try {
      const full = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { contact: true, conversations: { include: { account: true }, take: 1 } },
      })
      const clid = (full?.contact as { ctwaClid?: string | null } | null)?.ctwaClid ?? null
      if (clid) {
        const wabaId = full?.conversations?.[0]?.account?.cloudWabaId ?? null
        const { sendCapiEvent } = await import('@/lib/crm/capi')
        void sendCapiEvent({
          eventName: 'Purchase',
          ctwaClid: clid,
          wabaId,
          value: full?.value || 0,
          currency: 'BRL',
          phone: full?.contact?.phone ?? null,
          eventId: `${leadId}:purchase`,
        }).catch(() => {})
      }
    } catch (e) {
      console.error('[capi] purchase no won falhou (ignorado):', e)
    }
  }
```

> Dica: garanta que o campo **Valor** do lead esteja preenchido antes de mover para "Ganho" — é ele que vai como `value` do `Purchase` e alimenta o ROAS na Meta.

### 2.5 Variáveis de ambiente

Em `.env` (e documente no `.env.example`):

```bash
# ── Conversions API — Clique-para-WhatsApp (CTWA) ──
META_CAPI_DATASET_ID=""   # ID do conjunto de dados do Gerenciador de Eventos
META_CAPI_TOKEN=""        # token do dataset; se vazio, usa WHATSAPP_CLOUD_TOKEN
```

---

## Parte 3 — Testar

1. Preencha `META_CAPI_DATASET_ID` (e `META_CAPI_TOKEN` se for usar um dedicado) no `.env` e suba a aplicação.
2. No **Gerenciador de Eventos → seu dataset → Testar eventos**, você acompanha os eventos chegando em tempo real.
3. Clique no seu **próprio anúncio** de teste (ou use um link de pré-visualização CTWA) e mande uma mensagem. No log do servidor deve aparecer `[capi] evento OK: Lead ...` e o evento surge em "Testar eventos".
4. Mova esse lead para a etapa **Ganho** com um valor preenchido → deve sair `[capi] evento OK: Purchase ...`.
5. Confira a **qualidade da correspondência de eventos** no dataset (ideal manter alto enviando `ph`, que já mandamos hasheado).

---

## Parte 4 — Ligar a otimização na campanha

Só depois que os eventos estiverem chegando de forma consistente:

1. No conjunto de anúncios da campanha de **Vendas**, em *Local da conversão*, use **WhatsApp** e selecione o **dataset** correspondente.
2. Comece otimizando por **conversas** (volume, aprende rápido). Quando houver volume de eventos `Purchase`/`Lead` suficiente, troque a **meta de otimização** para o evento de conversão (idealmente `Purchase`; se o volume for baixo demais, use `Lead`).
3. Regra prática: um conjunto de anúncios aprende melhor com ~50 eventos de otimização por semana. Se `Purchase` for raro demais no começo, otimize por `Lead` e vá subindo o funil conforme o volume crescer.

---

## Resumo dos arquivos tocados

| Arquivo | Mudança |
|---|---|
| `src/lib/crm/capi.ts` | **Novo.** Função `sendCapiEvent` (envia evento pra Meta). |
| `prisma/schema.prisma` | +3 campos em `Contact` (`ctwaClid`, `ctwaClidAt`, `adReferral`) + migração. |
| `src/app/api/whatsapp/webhook/route.ts` | Captura `referral.ctwa_clid`, grava no contato, dispara `Lead`. |
| `src/app/actions/lead.ts` | Dispara `Purchase` quando o lead entra em etapa `isWon`. |
| `.env` / `.env.example` | `META_CAPI_DATASET_ID`, `META_CAPI_TOKEN`. |
