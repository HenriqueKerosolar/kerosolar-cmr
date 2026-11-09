# KeroSolar CRM

<!-- BIBLIOTECA:INICIO -->
## Biblioteca de peças — regra obrigatória (Gate 0)

Existe uma Biblioteca central de peças prontas em `D:/Projetos/Biblioteca` (protocolo completo: `D:/Projetos/Biblioteca/docs/PROTOCOLO-BIBLIOTECA.md`).

**ANTES de escrever qualquer motor, módulo, integração, utilitário, schema ou tela reutilizável, consulte a Biblioteca:**

```bash
node D:/Projetos/Biblioteca/scripts/consultar.mjs <palavras>          # peças prontas
node D:/Projetos/Biblioteca/scripts/consultar.mjs <palavras> --todas   # inclui candidatas
```

1. **Existe e serve** → use: `node D:/Projetos/Biblioteca/scripts/usar.mjs <id> --projeto <pasta deste projeto>` (fixa a versão em `biblioteca.lock.json`). Não copie o código para dentro do projeto.
2. **Existe mas precisa de mudança** → NÃO edite a peça nem uma cópia local. Crie uma versão nova na Biblioteca (`scripts/nova-versao.mjs`). A versão antiga permanece intacta para os outros projetos. Este projeto migra para a nova quando quiser.
3. **Só existe como candidata** → peça a extração (`scripts/requisitar.mjs`) ou extraia seguindo `docs/PADRAO-DE-PECA.md`; não reimplemente do zero.
4. **Não existe** → registre a necessidade (`scripts/requisitar.mjs "<o que>" --projeto <nome>`). Se for algo genérico, crie como peça na Biblioteca (nunca só no projeto). Código específico deste produto pode ficar aqui.

Regras que não mudam: nunca editar uma versão congelada; nunca colocar segredo, `.env` ou chave na Biblioteca; peça nova nasce com testes, contrato e CHANGELOG; ao terminar, rode `node D:/Projetos/Biblioteca/scripts/verificar.mjs`.
<!-- BIBLIOTECA:FIM -->
