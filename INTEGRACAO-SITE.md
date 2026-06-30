# Integração Chat do Site com CRM

API para integrar o chat do site keroservice.com.br com o CRM KeroSolar.

## Endpoint

```
POST https://seu-dominio-crm.com/api/public/chat-site
```

## Ações

### 1. Iniciar Conversa (Visitor entrou no chat)

```json
{
  "action": "start",
  "visitorName": "João Silva",
  "visitorEmail": "joao@example.com"
}
```

**Resposta:**
```json
{
  "ok": true,
  "convId": "cuid123xyz"
}
```

Guarde o `convId` para usar nas próximas mensagens.

---

### 2. Enviar Mensagem (Visitor digitou algo)

```json
{
  "action": "message",
  "convId": "cuid123xyz",
  "message": "Olá, estou interessado em energia solar"
}
```

**Resposta:**
```json
{
  "ok": true
}
```

---

### 3. Fornecer WhatsApp (Visitor clicou em "Continuar no WhatsApp")

```json
{
  "action": "set-whatsapp",
  "convId": "cuid123xyz",
  "whatsapp": "11987654321"
}
```

**Resposta:**
```json
{
  "ok": true,
  "convId": "cuid123xyz"
}
```

Após isso, a conversa passa para o WhatsApp Cloud API e continua nele.

---

## Fluxo Completo (Frontend do Site)

```javascript
let convId = null

// 1️⃣ Visitor abre o chat
async function iniciarChat() {
  const res = await fetch('https://seu-crm.com/api/public/chat-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'start',
      visitorName: prompt('Seu nome?'),
      visitorEmail: prompt('Seu email?'),
    }),
  })
  const data = await res.json()
  convId = data.convId
  console.log('Chat iniciado:', convId)
}

// 2️⃣ Visitor digita e envia mensagem
async function enviarMensagem(texto) {
  await fetch('https://seu-crm.com/api/public/chat-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'message',
      convId,
      message: texto,
    }),
  })
}

// 3️⃣ Sistema pede WhatsApp (automático ou botão)
async function pedirWhatsApp() {
  const whatsapp = prompt('Seu WhatsApp (só número):')
  await fetch('https://seu-crm.com/api/public/chat-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set-whatsapp',
      convId,
      whatsapp,
    }),
  })
  console.log('WhatsApp registrado! Continuando lá...')
}
```

---

## No CRM

- ✅ Conversa aparece em `/app` com canal **site**
- ✅ Contacto criado temporariamente com nome/email do visitor
- ✅ Quando fornece WhatsApp, atualiza o contato
- ✅ IA responde automaticamente (se habilitada)
- ✅ Operador pode responder manualmente

---

## Segurança

- 🔐 Considerando adicionar API Key ou validação de origem
- Por enquanto é aberta (no mesmo servidor)
- Se tiver públicas, usar rate limiting

Quer adicionar autenticação?
