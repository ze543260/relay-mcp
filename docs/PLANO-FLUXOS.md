# Plano: fluxos de trabalho aprovados localmente

Status: proposta · Autor: Claudio (claude-joao) · Pedido por: João ([184]–[188], [370], [385]), desenho do Lume ([186]–[189])
Revisão: Lume

> **v2 ([385])**: o **arquivo de workflow é em inglês**, com chaves, tipos de nó, campos e valores fixos (`steps`, `run`, `if`, `for_each`…). O plano continua em português. Só os textos de exibição (`description`, `label`) podem ser traduzidos. Também foi adicionada a seção 12, **fluxos entre IAs**.

## 1. Objetivo

Alguém pede no relay "revisa a UX do PR 12 do landing" e o agente de um dono **executa um fluxo que esse dono aprovou antes**, num ambiente isolado, e devolve o resultado na sala. Exemplos: subir um `docker compose` e testar o front como designer de UX, rodar a suíte de testes de um PR, gerar prints de telas.

## 2. Regra central

> O relay só **aciona fluxos pelo nome**. O que o fluxo faz foi lido e aprovado pelo dono, está fixado por hash no PC dele, e nada além disso roda, "faça chuva ou faça sol".

Quem comprometer o relay ou a sala consegue no máximo **pedir** um fluxo já aprovado com parâmetros já validados. Não consegue trocar o que ele faz.

## 3. Formato do fluxo

```yaml
name: review-ux
version: 3
description: Sobe o front de um repo da minha lista e avalia a UX das telas principais.
params:
  repo: { type: choice, from: approved_repos }     # lista local do dono, nunca texto livre
  pr:   { type: integer, min: 1 }
environment:
  image: node:22-bookworm                          # container; sem montar pastas pessoais
  network: [github.com, registry.npmjs.org]        # lista de saída permitida
  timeout: 15m
steps:
  - clone: "{repo}"
    ref: "pull/{pr}/head"
  - run: [npm, ci]
  - run: [npm, run, build]
  - serve: { command: [npx, vite, preview, --port, "4173"], port: 4173 }
  - agent: "Avalie a UX de http://localhost:4173 como designer: hierarquia, contraste, estados vazios, mobile. Até 15 achados, com print."
output: [report.md, screenshots/*.png]
```

- **Parâmetros tipados**: só preenchem campos declarados; `choice` vem de lista local; `run` é sempre lista de argumentos (sem shell), então um parâmetro nunca vira trecho de comando.
- O passo `agent` dá ao Claude **só** as ferramentas do sandbox (navegador e arquivos do container), não as do PC.
- **O container não tem nenhum segredo.** `npm ci` de um PR roda scripts de terceiros (`postinstall`), então tudo lá dentro é tratado como hostil. A chave da API do Claude fica **no executor, fora do container**: o passo `agent` fala com um proxy local do executor, que injeta a chave e limita as chamadas daquela execução.
- O texto do prompt de `agent` pode ser em qualquer língua (é conteúdo, não estrutura).

## 4. Catálogo, aprovação e hash

1. **Catálogo no relay**: `POST /fluxos` publica `name@version` com o YAML; o servidor guarda o SHA-256. Qualquer membro publica; publicar não dá permissão de rodar em lugar nenhum.
2. **Aprovação local**: o executor do dono baixa, mostra o YAML inteiro e o diff contra a versão aprovada anterior. O dono aprova **no PC dele** (não pelo relay) e o executor grava em `~/.relay/workflows/approved.json`: `{name, version, sha256, allowed_requesters, mode}`.
3. **Na execução**: baixa de novo e confere o hash. Diferente em um byte → não roda e pede nova aprovação.

`allowed_requesters`: lista de pessoas (ex.: `["jose","joao-vitor"]`) e, desde a seção 12, de agentes. `mode`: `confirm` (o dono confirma cada execução) ou `audit` (roda e registra; só para fluxos sem rede além da lista e sem segredos).

## 5. Pedido e execução

1. Na sala: `/fluxo review-ux @claudio repo=joao/landing pr=12` → mensagem do tipo **pedido**, endereçada a um agente.
2. O executor do dono (processo local, não o Claude) recebe o pedido pelo vigia e checa: fluxo aprovado + hash confere + quem pediu está em `allowed_requesters` + parâmetros válidos. Falhou algo → responde na sala com o motivo e para.
3. `mode: confirm` → notificação para o dono (Clawd / app); sem resposta em 30 min, expira.
4. Roda no container com o tempo máximo; o Claude entra só no passo `agent`.
5. Posta o resultado: resumo na sala, `report.md` e prints pelo 📎.

## 6. Auditoria do dono

Cada execução grava localmente (e opcionalmente no relay, visível só ao dono) em `~/.relay/workflows/audit/<data>-<id>.json`: quem pediu, fluxo e hash, parâmetros, comandos rodados, saída (cortada), duração, arquivos gerados e resultado. O dono tem "revisar depois" no app/web e pode **revogar** um fluxo, o que vale na hora.

## 7. Componentes

| Peça | Onde | Faz |
|---|---|---|
| Catálogo `/fluxos` | `relay_server.py` | publicar, listar, baixar YAML + hash |
| `relay_executor.py` | PC do dono | aprovação, verificação, sandbox (Docker), auditoria |
| Mensagem `pedido` | servidor + web/app | tipo novo de mensagem com botão "aprovar" para o dono |
| MCP | `relay_mcp.py` | `listar_fluxos`, `pedir_fluxo` (só cria o pedido; nunca executa) |

O executor é **um programa à parte**, não o Claude Code com permissões amplas. É ele que lê o YAML e roda os passos; o Claude é chamado só dentro do sandbox.

## 8. Fases

| Fase | Entrega |
|---|---|
| 1 | Catálogo com hash; `relay_executor.py` com aprovação local, verificação e um fluxo sem rede (rodar testes de um repo da lista) |
| 2 | Container com lista de rede; pedidos na sala; `mode: confirm` com notificação |
| 3 | Passo `agent` (Claude no sandbox) e o fluxo `review-ux` |
| 4 | Auditoria no web/app; `mode: audit` |

Depende do `PLANO-PAPEIS.md` (dono do agente, quem pode pedir) e do `PLANO-REPOS.md` (lista de repos).

## 9. Testes

- YAML alterado em um byte → recusado; versão nova sem aprovação → recusada.
- Parâmetro com `; rm -rf ~` ou `../` → recusado na validação, nunca chega ao container.
- Pedido de alguém fora de `allowed_requesters` → recusado com motivo.
- Container não enxerga a home do dono; saída para host fora da lista é bloqueada.
- Nenhuma variável de ambiente ou arquivo do container contém chave de API (o `postinstall` de teste procura e não acha).
- Tempo máximo estourado → processo morto, auditoria registra.
- Chave em português (`passos`, `rodar`) → recusada com erro apontando a chave em inglês.

## 10. Em aberto

1. Docker Desktop como pré-requisito no Windows, ou WSL?
2. Fluxos podem usar segredos (ex.: token de staging)? Proposta: não na fase 1; depois, segredo local por fluxo, nunca vindo do relay.
3. Limite de execuções simultâneas por dono.

## 11. Estudo: condicionais, laços e editor em fluxograma

Pedido do João em [370]. Até a seção 10 o fluxo é uma lista reta de passos. Aqui ele vira um **fluxograma**, com desvios e repetições, montado por interface e guardado localmente por hash. A regra central (seção 2) não muda: **só roda o que o dono aprovou, byte a byte**. Condição e laço só escolhem entre caminhos que já estavam no fluxo aprovado e nunca criam passo novo.

### 11.1 Modelo: um grafo de nós com limite

O fluxo passa a ser um grafo dirigido. O formato canônico é JSON e o YAML continua aceito na entrada.

```yaml
name: test-pr
version: 4
params:
  repo: { type: choice, from: approved_repos }
  pr:   { type: integer, min: 1 }
  browsers: { type: list, from: [chromium, firefox], max: 2 }
limits: { max_steps: 40, timeout: 20m }
nodes:
  - id: clone
    clone: "{repo}"
    ref: "pull/{pr}/head"
    next: install
  - id: install
    run: [npm, ci]
    outputs: { exit_code: integer }
    next: install_ok
  - id: install_ok
    if: "install.exit_code == 0"
    then: per_browser
    else: failed
  - id: per_browser
    for_each: { item: browser, in: "params.browsers", max: 2 }
    body: e2e
    after: summary
  - id: e2e
    run: [npx, playwright, test, --project, "{browser}"]
    retry: { times: 2, when: "e2e.exit_code != 0" }
    outputs: { exit_code: integer }
  - id: summary
    agent: "Resuma os resultados dos testes em até 10 linhas."
    outputs: { verdict: { type: choice, from: [approved, changes, blocked] } }
    next: done
  - id: failed
    fail: "npm ci failed"
  - id: done
    end: true
layout: { clone: [0, 0], install: [0, 120] }   # posições do editor, fora do hash
```

**Tipos de nó**

| Nó | Faz | Limite |
|---|---|---|
| `clone`, `run`, `serve`, `agent` | os passos da seção 3 | os de lá |
| `agent_step` | pede uma tarefa a **outro agente** da sala (seção 12) | `timeout` obrigatório |
| `if` | desvia por uma condição (`then` / `else`) | os dois ramos são obrigatórios |
| `switch` | desvia por um valor `choice` (um ramo por opção + `default`) | opções fechadas |
| `for_each` | repete um subgrafo para cada item de uma lista | `max` obrigatório, ≤ 20 |
| `repeat_until` | repete até a condição ser verdadeira | `max` obrigatório, ≤ 10 |
| `retry` | atributo de um passo, não um nó | `times` ≤ 3 |
| `approval` | pausa até o dono confirmar (Clawd ou app) | expira em 30 min |
| `fail`, `end` | encerram | — |

**Não existe `while` sem limite nem `goto` livre.** Todo ciclo do grafo sai de um nó de laço com `max`, então o pior caso é calculável antes de rodar.

### 11.2 Condições: uma linguagem pequena, sem `eval`

- Gramática fechada: comparações (`== != < <= > >=`), `and`, `or`, `not`, `in`, parênteses, literais (número, texto, `true`/`false`) e referências `params.x`, `<node>.<output>` e `<loop>.index`.
- Interpretada por um parser próprio de umas 150 linhas, com testes. Nunca passa por `eval`, Python ou shell. Na aprovação, uma referência a nó ou saída que não existe é recusada.
- **Só as saídas declaradas e tipadas** entram em condição (`outputs:`). O texto livre de um passo `agent` não entra: o agente devolve uma `choice` fechada (`verdict`), validada pelo executor. Assim, uma injeção de prompt no código do PR pode no máximo puxar um ramo que o dono já aprovou, nunca criar um caminho.
- Condição não lê variável de ambiente, arquivo nem segredo.

### 11.3 Validação estática (antes de aprovar e de novo antes de rodar)

1. Todo nó é alcançável a partir do primeiro, e todo caminho termina em `end` ou `fail`.
2. Todo ciclo passa por um nó de laço com `max`. Por enquanto não há laço aninhado mais de 2 níveis.
3. **Pior caso calculado**: o maior número de passos possível, multiplicando os `max`. Se passar de `limits.max_steps` (teto absoluto de 200), o fluxo é recusado. A tela de aprovação mostra esse número ("no pior caso: 14 passos, 20 min").
4. Parâmetros, saídas e `{interpolacoes}` referenciam coisas declaradas. A interpolação só vale dentro de argumentos de lista (seção 3), nunca para montar comando.
5. No máximo 100 nós e 64 KB por fluxo.
6. Chaves desconhecidas são recusadas (esquema fechado, em inglês). Isso pega erro de digitação e chave em português.

### 11.4 Hash e armazenamento local

- **O hash sai da forma canônica, não do texto**: JSON canônico (RFC 8785, JCS) do fluxo **sem** `layout`. Assim, reindentar o YAML ou arrastar caixinhas no editor não pede nova aprovação, mas mudar um argumento, uma condição ou uma seta pede.
- Pasta endereçada por conteúdo, no PC do dono:
  ```
  ~/.relay/workflows/
    objects/sha256/ab/abcd….json   # forma canônica, somente leitura
    approved.json                   # {name, version, sha256, allowed_requesters, mode, approved_at}
    layout/<sha256>.json            # posições do editor (não confiável, só visual)
    audit/<data>-<id>.json
  ```
  O nome do arquivo é o próprio hash: o executor recalcula ao abrir, e se não bater, o arquivo é apagado e baixado de novo. O `approved.json` guarda também o próprio hash num arquivo vizinho, para detectar edição fora do executor.
- **Baixar uma vez, rodar offline**: o executor roda o objeto local aprovado. O relay só manda o pedido (nome, versão, parâmetros), e o executor nem consulta o catálogo para executar. Se o relay for comprometido, o fluxo continua o mesmo.
- **Depois (fase 6)**: assinatura Ed25519 de quem publicou (`minisign`), para o dono saber que a versão nova veio da mesma pessoa. O hash garante que o conteúdo não mudou; a assinatura diz quem o escreveu.

### 11.5 Editor em fluxograma (web; app só visualiza)

- Biblioteca: **React Flow (`@xyflow/react`)**. É MIT, feita para editor de nós, tem setas, zoom, minimapa e layout salvo, e fica leve no bundle do Vite. Layout automático com `elkjs` no botão "organizar".
- **Paleta** com os tipos de nó; arrastar para o quadro; ligar saindo das portas (`then`/`else` são portas diferentes, coloridas).
- **Painel do nó** com formulário tipado em vez de texto livre: `run` monta a lista de argumentos em chips; `if` tem um **construtor de condição** com listas suspensas (saída › operador › valor) e um modo texto opcional, validado ao digitar.
- A interface pode mostrar rótulos traduzidos ("Rodar", "Se"), mas o arquivo gerado é sempre em inglês.
- **Validação ao vivo** (11.3) com o erro marcado no nó, mais o contador de pior caso no rodapé.
- **Simular**: roda o grafo com saídas falsas escolhidas na mão (ex.: `install.exit_code = 1`) e acende o caminho. Não executa nada.
- **Ver como YAML**, nos dois sentidos, e **Publicar** (`POST /fluxos`). Publicar não aprova (seção 4).
- **Tela de aprovação (executor/Clawd)**: o fluxograma com **diff visual** contra a versão aprovada (nó novo em verde, alterado em amarelo, seta removida tracejada), o diff textual da forma canônica e o pior caso. Aprovar continua sendo **no PC do dono**: o web só mostra.

### 11.6 Execução: máquina de estados

- O executor percorre o grafo nó a nó. Cada transição vai para a auditoria (`node`, `input`, `output`, `branch_taken`, `duration`), e a tela de "revisar depois" redesenha o fluxograma com o caminho que rodou.
- Contadores globais de passos e tempo são checados a cada nó, além dos `max` de cada laço. Se estourar, o executor mata o container e registra.
- Na fase 1 não há retomada: se o executor cair no meio, a execução é marcada como `interrupted` e precisa de um novo pedido.

### 11.7 Testes novos

- Ciclo sem nó de laço → recusado; `for_each` sem `max` → recusado; pior caso acima do limite → recusado com o número.
- Condição com `__import__`, `;`, crase ou referência inexistente → recusada no parser.
- Agente devolvendo um `verdict` fora das opções → o passo falha, e nenhum ramo é escolhido.
- Mudar só o `layout` mantém o hash; mudar uma condição muda o hash e pede aprovação.
- Objeto local adulterado → detectado ao abrir, rebaixado ou recusado.
- Simular não cria container nem processo.

### 11.8 Fases (encaixam no plano da seção 8)

| Fase | Entrega |
|---|---|
| 1b | Modelo de grafo + parser de condição + validação estática + hash canônico (só back e executor, sem tela) |
| 2b | Editor React Flow no web: montar, validar, simular, publicar |
| 3b | Tela de aprovação com diff visual; auditoria com caminho percorrido |
| 4b | Fluxos entre IAs (`agent_step`, seção 12) |
| 6 | Assinatura do publicador |

Divisão: back, executor e parser comigo; editor e telas com o Lume.

### 11.9 Em aberto

1. Paralelismo (dois ramos ao mesmo tempo): fica de fora até a fase 3b, porque complica a auditoria e os limites.
2. Subfluxos (um fluxo chamar outro aprovado pelo hash): úteis, mas cada um somaria o pior caso do outro. Proposta: depois da fase 3b.
3. Saídas de arquivo (`report.md`) entram em condição só por existência/tamanho, nunca pelo conteúdo?

## 12. Fluxos entre IAs

Pedido do João em [385]. Um fluxo pode ter passos feitos por **outros agentes da sala** (`claude-jose`, `claude-julio`…). Exemplo: o Claudio roda os testes, o Lume avalia a UX e o resultado volta para o fluxo do Claudio decidir o próximo ramo.

### 12.1 Regra: pedir, nunca executar na máquina do outro

- Um `agent_step` **só envia um pedido** de fluxo ao executor do outro dono, pelo mesmo caminho da seção 5. Cada um roda só fluxos que **o próprio dono** aprovou por hash, na própria máquina.
- O fluxo de quem pede guarda **qual fluxo remoto** chama, com o hash dele (`expect_sha256`). Se o outro dono trocar a versão, o passo falha em vez de rodar algo diferente do aprovado.
- O pedido só é aceito se o agente que pede estiver em `allowed_requesters` do fluxo remoto, por exemplo `["jose", "claude-joao"]`.

```yaml
  - id: ux_review
    agent_step:
      agent: claude-jose
      workflow: review-ux
      version: 3
      expect_sha256: "9f2c…"
      params: { repo: "{repo}", pr: "{pr}" }
      timeout: 30m
    outputs: { verdict: { type: choice, from: [approved, changes, blocked] } }
    next: decide
  - id: decide
    switch: ux_review.verdict
    cases: { approved: merge_ready, changes: notify, blocked: failed }
    default: failed
```

### 12.2 Contrato do resultado

- O agente remoto devolve **só as `outputs` declaradas e tipadas**, mais anexos (relatório, prints). Texto livre não entra em condição: vale a mesma barreira contra injeção de prompt da seção 11.2.
- Se a resposta não bater com o tipo (`verdict` fora das opções, campo faltando), o passo falha e nenhum ramo é escolhido.
- Sem resposta até o `timeout`, o passo vai para `fail` (ou para um ramo `on_timeout`, se o fluxo declarar).

### 12.3 Limites contra loop entre agentes

- Cada pedido carrega uma `chain` com a lista de fluxos/agentes já percorridos e um `depth`. O máximo é **3 saltos**, e um fluxo que já está na cadeia não é pedido de novo (A → B → A é recusado).
- O pior caso (11.3) conta o `timeout` do `agent_step` como o tempo do passo. Os passos do outro lado entram na conta do fluxo remoto, que o dono dele já aprovou.
- Um `agent_step` dentro de `for_each` conta como N pedidos, e cada agente tem um teto de pedidos recebidos por hora.

### 12.4 Relay

- Novo tipo de mensagem `pedido_fluxo` com `correlation_id`, e a resposta `resultado_fluxo` com o mesmo id. Assim o executor de quem pediu sabe qual passo destravar.
- A auditoria dos dois lados registra o `correlation_id` e mostra a execução como uma cadeia ("Claudio → Lume → volta").
- MCP: `pedir_fluxo` ganha `aguardar=True` para uso interativo, mas dentro de um fluxo quem espera é o executor, não o Claude.

### 12.5 Testes

- Agente fora de `allowed_requesters` → recusado pelo executor remoto.
- `expect_sha256` diferente do aprovado remoto → passo falha sem rodar.
- Cadeia A → B → A, ou `depth` > 3 → recusada.
- Resposta com `verdict` inválido ou campo extra → passo falha.
- Timeout → ramo `on_timeout` ou `fail`, e a auditoria registra.

## 13. Estado da implementação (back)

Aprovado pelo João em [391]. Back e executor estão neste PR; editor e telas ficam com o Lume.

| Peça | Arquivo | O que já faz |
|---|---|---|
| Esquema, condições, validação, hash | `relay_fluxos.py` | esquema fechado em inglês (chave em português dá erro com a sugestão), `steps` linear vira `nodes`, parser de condição próprio, DAG + laços com `max`, pior caso, moldes só com o que foi declarado, forma canônica sem `layout` |
| Catálogo e pedidos | `relay_server.py` (migração 17) | `GET/POST /fluxos`, `GET /fluxos/<nome>?versao=`, `POST/GET /fluxos/pedidos`, `GET /fluxos/pedidos/<id>`, `POST /fluxos/pedidos/<id>/estado` (aceito, recusado, concluido, falhou, cancelado; pendente expira) |
| Executor | `relay_executor.py` | loja endereçada por hash, `approved.json` com hash vizinho, aprovação só em terminal (digitando o início do hash), diff contra a versão aprovada, Docker sem rede e sem segredo, clone no host sem hooks, máquina de estados com auditoria, modo `confirm`, `agent` pela API com saída tipada forçada, `agent_step` pelo relay |
| MCP | `relay_mcp.py` | `listar_fluxos`, `ver_fluxo`, `publicar_fluxo`, `pedir_fluxo` (com `aguardar`), `ver_pedido` |
| Testes | `tests/test_fluxos.py` | os casos das seções 9, 11.7 e 12.5, com sandbox e agente falsos |

Decisões tomadas na implementação:
- **Só JSON** no servidor e no executor, que são só stdlib. O editor gera JSON; o YAML dos exemplos é para leitura.
- **Rede**: um fluxo com `network` só roda se o dono configurar `RELAY_EXEC_REDE`, uma rede Docker com saída filtrada. Sem isso o executor recusa, em vez de abrir a rede inteira.
- **`environment.image` é obrigatório**: nada roda direto no host além do `git fetch`.
- **Uma execução por vez** por executor (resposta ao item 3 da seção 10).
- `repeat_until` que esgota o `max` sem a condição ficar verdadeira **falha**.
- `run` sem `outputs` que sai com código ≠ 0 falha o fluxo; com `outputs: {exit_code: integer}`, quem decide é o fluxo.
- O que volta num `agent_step` são as saídas tipadas da execução remota; quem pediu fica só com as que declarou e confere o `sha256` devolvido.

Ainda falta:
- O passo `agent` não tem o navegador do sandbox: o Claude recebe só os logs dos passos anteriores. O proxy da chave e as ferramentas dentro do container ficam para a fase 3.
- A rede filtrada (proxy de saída) é configuração do dono, não vem pronta.
- Anexos (`report.md`, prints) ainda não sobem para a sala; o relatório volta no `resultado` do pedido, com até 8 KB.
- Assinatura do publicador (fase 6).
