# DMs do Facebook/Instagram pelo Mind Marketing (Nervo) — guia de operação

Plano e decisões: [plano-dm-meta-via-nervo.md](plano-dm-meta-via-nervo.md). Contrato v1, igual ao do Marketing
(`bff/src/nervo/socialMessages.ts` de lá): `social.message.received`, `social.message.send` e `social.message.sent`.

## Como funciona no CRM
1. O Mind Marketing recebe a DM na Página da KeroSolar e publica `social.message.received`.
2. O CRM (`src/lib/nervo/socialMessages.ts` + `dmBridge.ts`):
   - guarda em `Contact.customFields.metaBridge` por onde responder (clientAccountId, pageId, canal);
   - grava a mensagem no Inbox;
   - atende pelo mesmo motor do WhatsApp (IA ou humano).
   - Reentrega não duplica, porque deduplica pelo `externalId`.
   - Responde ao Mind em até 5 s; se o atendimento demorar mais, ele continua em segundo plano.
3. Toda resposta (IA, follow-up, humano pelo Inbox) passa por `dispatchOutbound`. Se a conversa é da ponte, ela vira `social.message.send` com `requestId` = id da `Message` do CRM.
   - Fora da janela de 24h da Meta, a mensagem não é enviada e o motivo fica na mensagem.
4. O Marketing entrega e devolve `social.message.sent`: entregue (grava o id da Meta) ou falha, com o motivo em português no Inbox. A falha nunca é silenciosa.
5. A caixa de saída e a de entrada são duráveis em Postgres (`nervo_outbox` e `nervo_inbox`), então nada se perde num reinício. O envio sai na hora do evento. Existe uma passada de segurança 1 minuto depois de subir e depois uma vez por dia (`src/instrumentation.ts`); não há cron em minutos.
6. Tela **Insta/Face** (`/meta`, só admin): não salva mais conexão própria com a Meta. Mostra o estado do Nervo e tem o botão **Conectar ao Mind**.

Com o Nervo desligado (sem `NERVO_BASE_URL`), o CRM funciona como antes e nada da ponte roda.

## Para ligar (dono) — nesta ordem
1. **Banco: criar as tabelas.** É idempotente e pode rodar duas vezes. Sempre antes do deploy.
   ```
   railway run node scripts/nervo-migrar.mjs
   ```
2. **Variáveis no Railway** (serviço do CRM):
   - `NERVO_BASE_URL=https://153-76-114-150.sslip.io`
   - `MIND_MARKETING_CLIENT_ACCOUNT_ID=9b1f177e-9bcf-44da-93e9-53aa994ab9ae`
   - `NERVO_INBOUND_URL` pode ficar sem: a URL vem de `NEXT_PUBLIC_APP_URL` + `/api/public/nervo/inbound`.
   - `SESSION_SECRET` já existe, com 44 caracteres.
3. **Deploy do CRM.** O CRM vai primeiro, o Marketing depois.
4. **Pareamento:** em CRM → Insta/Face, clique em **Conectar ao Mind**. Aparece o código `XXXX-XXXX`, válido por 15 minutos. No painel do Mind, em "Meu Workspace" (production), aceite o pedido com o mesmo código e volte ao CRM em **Verificar agora**, até aparecer "Conectado ao Mind".
5. **Marketing:** a sessão do Mind Marketing liga a ponte na Página da KeroSolar (`CRM_DM_BRIDGE_PAGE_IDS`) e publica na Vercel.
6. **Teste:** mande uma DM para a página da KeroSolar. Ela deve aparecer no Inbox do CRM, e a resposta deve chegar no Messenger.

## Riscos conhecidos
- **Mídia na resposta** (imagem, PDF) ainda não vai pela ponte: o contrato v1 só tem texto.
- **Áudio** do cliente chega como anexo, mas não é transcrito nesta versão.
- **Mensagem perdida num reinício:** se o servidor reiniciar exatamente durante o atendimento de uma DM, depois da confirmação ao Mind, a mensagem do cliente já está gravada, mas a resposta da IA pode não sair. O operador vê a conversa no Inbox.
