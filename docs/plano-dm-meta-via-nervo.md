# Plano — Mensagens diretas do Facebook/Instagram da KeroSolar via Mind Marketing + Nervo

**Decisão do dono (Henrique, 14/11/2026):** UMA conexão só com a Meta. O CRM **não** configura conexão própria com Facebook/Instagram (tela "Insta/Face" do CRM fica sem salvar).

## Situação hoje
- **Mind Marketing** (`D:\Projetos\Mide Marketing`, Vercel):
  - Conecta à Meta por OAuth (`bff/src/metaOAuth.ts`, tokens cifrados em `client_oauth_connections`).
  - Recebe DMs (Messenger e Instagram Direct) e comentários no webhook `bff/src/routes/metaWebhook.ts`.
  - Já envia mensagens (`sendMessengerMessage` / `sendInstagramMessage` em `bff/src/metaPages.ts`).
  - Pelo Nervo, publica `lead.captured` e `social.engagement.captured`, este **só com comentários**, e consome `lead.qualified`, `lead.won` e `lead.lost`.
  - Ele mesmo responde DMs com um robô próprio.
- **KeroSolar CRM** (`D:\Projetos\KeroSolar CRM`, Railway): tem o Nervo no código (`src/lib/nervo/`), mas **desligado em produção**, porque não há variáveis `NERVO_*` no Railway. Por isso as DMs não chegam ao CRM.
- **Mind / Orquestrador** (`D:\Projetos\Ai DEV Orquestrator`): faz o pareamento e a administração do Nervo, com chaves Ed25519 (`@lib/nervo` 0.5.0). Regra do dono: nada é alterado no repositório do Orquestrador sem OK explícito dele.

## Formato proposto
1. **Marketing → CRM** — evento `social.message.received`:
   `{ externalId, channel: 'facebook'|'instagram', pageId, senderId, senderName?, text, attachments?: [{type,url}], sentAt }`.
   Vale só para a página da KeroSolar. `externalId` é o id da mensagem na Meta e evita duplicar.
2. **CRM:** a mensagem entra no Inbox como conversa do canal facebook/instagram, e a IA atende igual ao WhatsApp. Também pode ser o humano, pelo Inbox.
3. **CRM → Marketing** — pedido `social.message.send`:
   `{ channel, pageId, recipientId, text, replyToExternalId?, requestId }`.
   O Marketing envia pela Send API e devolve `social.message.sent` `{ requestId, externalId, ok, error? }`. Erros comuns: janela de 24h da Meta fechada, token expirado.
   Se o `@lib/nervo` atual não suportar pedido no sentido CRM → Marketing, a mudança vira **versão nova** da peça na Biblioteca (`scripts/nova-versao.mjs`), nunca edição de versão congelada.
4. O Marketing **desliga o próprio robô de resposta de DM** na página da KeroSolar, para o cliente não receber duas respostas. Comentários continuam com o Marketing.
5. **Pareamento:** o Mind liga o Nervo entre CRM e Marketing (variáveis `NERVO_*` no Railway do CRM e o que for preciso no Marketing).

## Regras de convivência (lição da semana de 09–14/11)
- Combinar o contrato **antes** de programar.
- Nenhum lado publica algo que dependa do outro sem os dois estarem prontos.
- Mudança de banco (tabela/campo novo) é aplicada **antes** do deploy do código que usa.
- Só uma sessão publica o CRM por vez. Quem publica o CRM é a sessão do CRM.
- Cada sessão mexe só no próprio repositório.

## Pontos de contato
- Sessão do CRM: **"KerosolarCRM new session (fork)"**. É o nome para usar no SendMessage.
- O dono aprova o formato final e o momento de publicar.

## Adendo (14/11/2026) — responder COMENTÁRIOS pelo CRM
Pedido do dono: além das DMs, poder responder comentários pelo CRM quando precisar. O Marketing continua respondendo comentários automaticamente; isto só acrescenta a resposta manual.
- **CRM → Marketing** `social.comment.reply` v1: `{ clientAccountId, channel: 'facebook'|'instagram', commentId, text, requestId }`. `commentId` é o `externalId` do comentário publicado no `social.engagement.captured`, e `requestId` é o id da `SocialCommentReply` do CRM, usado para deduplicar.
- **Marketing → CRM** `social.comment.replied` v1: `{ clientAccountId, requestId, ok, replyId?, error?: { code: 'TOKEN_EXPIRED'|'NOT_CONNECTED'|'NOT_FOUND'|'META_ERROR', message } }`.
- O Marketing responde pela API de comentários da Meta. Ele deduplica por `requestId` e tira o negrito estilo WhatsApp (`*texto*`).
- Hoje só os comentários do Facebook chegam ao CRM. Se o Marketing passar a publicar os do Instagram, o CRM já aceita `channel: 'instagram'`.
- Lado CRM: pronto no ramo `responder-comentarios`, com a tabela `social_comment_replies` (`scripts/migrar-respostas-comentario.mjs`). Publicado só junto com o lado do Marketing.
