# Regras do Agente IA — KeroSolar CRM

Documento vivo com todas as regras de negócio que o agente deve seguir.
Status: ✅ implementado · 🔜 a construir · ❓ a confirmar

## Cálculo solar
- ✅ Base do cálculo = **média anual de consumo (kWh)** do histórico da conta (12 meses)
- ✅ Valor do sistema = conta(R$) × 20,87 (réplica do simulador)
- ✅ Conversão kWh → R$ = kWh × 1,22 ("atende uma conta de aproximadamente R$ X")
- ✅ **Consumo < 250 kWh** → oferece o **kit mínimo de 300 kWh** ("menor kit que temos; se quiser mais, informe quantos kWh")
- ✅ Detecta cliente que já tem solar (Geração Distribuída / energia injetada)
- ✅ Custo de disponibilidade: monofásico 30 / bifásico 50 / trifásico 100 kWh

## Tipo de ligação (medidor)
- ✅ **Monofásico** → 2 opções: sistema monofásico OU 220V com transformador (sem problema)
- ✅ Monofásico + **mais de 800 kWh** → trocar ligação: **Enel** = aumento de carga p/ bifásico; **Light** = solicitar trifásico
- ✅ Conta com **cabeçalho completo** → NÃO perguntar município (já vem na conta)
- ✅ Cliente mandou **só a média** (sem cabeçalho) → perguntar só o tipo de medidor (mono/bi/tri)

## Horários
- ✅ Saudação Bom dia/Boa tarde/Boa noite conforme horário (Brasília)
- ✅ Mensagens automáticas: dias úteis 9–18h (config por funil), nada após 21h, acumuladas → próximo dia útil, espaçamento humano
- ✅ **Mensagem recebida após 21h** → recepção pergunta: "deixar registrado (retoma no horário comercial) ou prosseguir agora?"

## Respostas globais (valem mesmo com IA da etapa desligada, se a etapa tem automação)
- ✅ "Pra quanto cai a conta?" → script 70–85%, sem valor exato
- ✅ "Tem desconto à vista?" → **5% de desconto à vista** (valor × 0,95)

## Atendimento / handoff
- ✅ Cliente pede humano / recusa bot/IA/máquina → **bloqueio total** (humanOnly): para TODAS as automações, cancela agendamentos, transfere p/ humano
- 🔜 Bloqueio total dura **7 dias**; após isso, se o cliente voltar → mensagem de retorno
- 🔜 Mensagem de retorno: "Que bom que retornou! Vamos continuar e tentar resolver suas dúvidas e chegar a um acordo bom para você e resolver seu problema."
- 🔜 **Qualquer lead** (qualquer etapa) que retorne após **10 dias sem contato** → recebe a mensagem de retorno
- ❓ "os que pediram bloqueio não precisa reativar mais mensagens" → confirmar: clientes que pediram bloqueio NÃO voltam a receber automações automaticamente (só atendimento humano), mesmo após 7/10 dias?

## Tom e horários
- 🔜 Sempre cumprimentar com **Bom dia / Boa tarde / Boa noite** conforme o horário
- 🔜 **Não enviar mensagem após as 21h** (para ninguém)
- 🔜 **Mensagens de bot agendadas** só disparam em **dias úteis, 9h–18h**
- 🔜 Mensagens acumuladas fora do horário → começam no **próximo dia útil** dentro da faixa
- 🔜 **Não enviar tudo de uma vez** → espaçamento entre mensagens, tempos diferentes p/ cada uma (simulando digitação, evitar bloqueio)
- 🔜 (opcional) Caixa de config por funil p/ definir a faixa de horário de envio

## CRM / Chat
- 🔜 No chat do CRM **não mostrar as respostas da IA**; só aparece o que ficou **sem definição** ou que a **IA não soube responder** (precisa de humano)

## Disparos manuais
- 🔜 Poder disparar mensagens manualmente dentro de uma etapa, seguindo a mesma regra (espaçamento diferenciado + simulando digitação)
