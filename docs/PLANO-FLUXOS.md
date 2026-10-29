# Plano: fluxos de trabalho aprovados localmente

Status: proposta · Autor: Claudio (claude-joao) · Pedido por: João ([184]–[188]), desenho do Lume ([186]–[189])
Revisão: Lume

## 1. Objetivo

Alguém pede no relay "revisa a UX do PR 12 do landing" e o agente de um dono **executa um fluxo que esse dono aprovou antes**, num ambiente isolado, e devolve o resultado na sala. Exemplos: subir um `docker compose` e testar o front como designer de UX, rodar a suíte de testes de um PR, gerar prints de telas.

## 2. Regra central

> O relay só **aciona fluxos pelo nome**. O que o fluxo faz foi lido e aprovado pelo dono, está fixado por hash no PC dele, e nada além disso roda, "faça chuva ou faça sol".

Quem comprometer o relay ou a sala consegue no máximo **pedir** um fluxo já aprovado com parâmetros já validados. Não consegue trocar o que ele faz.

## 3. Formato do fluxo

```yaml
nome: revisar-ux
versao: 3
descricao: Sobe o front de um repo da minha lista e avalia a UX das telas principais.
parametros:
  repo: { tipo: escolha, de: repos_aprovados }    # lista local do dono, nunca texto livre
  pr:   { tipo: inteiro, min: 1 }
ambiente:
  imagem: node:22-bookworm                         # container; sem montar pastas pessoais
  rede: [github.com, registry.npmjs.org]           # lista de saída permitida
  tempo_max: 15m
passos:
  - clonar: "{repo}"
    ref: "pull/{pr}/head"
  - rodar: [npm, ci]
  - rodar: [npm, run, build]
  - servir: { comando: [npx, vite, preview, --port, "4173"], porta: 4173 }
  - agente: "Avalie a UX de http://localhost:4173 como designer: hierarquia, contraste, estados vazios, mobile. Até 15 achados, com print."
saida: [relatorio.md, prints/*.png]
```

- **Parâmetros tipados**: só preenchem campos declarados; `escolha` vem de lista local; `rodar` é sempre lista de argumentos (sem shell), então um parâmetro nunca vira trecho de comando.
- O passo `agente` dá ao Claude **só** as ferramentas do sandbox (navegador e arquivos do container), não as do PC.
- **O container não tem nenhum segredo.** `npm ci` de um PR roda scripts de terceiros (`postinstall`), então tudo lá dentro é tratado como hostil. A chave da API do Claude fica **no executor, fora do container**: o passo `agente` fala com um proxy local do executor, que injeta a chave e limita as chamadas daquela execução.

## 4. Catálogo, aprovação e hash

1. **Catálogo no relay**: `POST /fluxos` publica `nome@versao` com o YAML; o servidor guarda o SHA-256. Qualquer membro publica; publicar não dá permissão de rodar em lugar nenhum.
2. **Aprovação local**: o executor do dono baixa, mostra o YAML inteiro e o diff contra a versão aprovada anterior. O dono aprova **no PC dele** (não pelo relay) e o executor grava em `~/.relay/fluxos/aprovados.json`: `{nome, versao, sha256, quem_pode_pedir, modo}`.
3. **Na execução**: baixa de novo e confere o hash. Diferente em um byte → não roda e pede nova aprovação.

`quem_pode_pedir`: lista de pessoas (ex.: `["jose","joao-vitor"]`). `modo`: `confirmar` (o dono confirma cada execução) ou `auditar` (roda e registra; só para fluxos sem rede além da lista e sem segredos).

## 5. Pedido e execução

1. Na sala: `/fluxo revisar-ux @claudio repo=joao/landing pr=12` → mensagem do tipo **pedido**, endereçada a um agente.
2. O executor do dono (processo local, não o Claude) recebe o pedido pelo vigia e checa: fluxo aprovado + hash confere + quem pediu está em `quem_pode_pedir` + parâmetros válidos. Falhou algo → responde na sala com o motivo e para.
3. `modo: confirmar` → notificação para o dono (Clawd / app); sem resposta em 30 min, expira.
4. Roda no container com o tempo máximo; o Claude entra só no passo `agente`.
5. Posta o resultado: resumo na sala, `relatorio.md` e prints pelo 📎.

## 6. Auditoria do dono

Cada execução grava localmente (e opcionalmente no relay, visível só ao dono) em `~/.relay/fluxos/auditoria/<data>-<id>.json`: quem pediu, fluxo e hash, parâmetros, comandos rodados, saída (cortada), duração, arquivos gerados e resultado. O dono tem "revisar depois" no app/web e pode **revogar** um fluxo, o que vale na hora.

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
| 2 | Container com lista de rede; pedidos na sala; `modo: confirmar` com notificação |
| 3 | Passo `agente` (Claude no sandbox) e o fluxo `revisar-ux` |
| 4 | Auditoria no web/app; `modo: auditar` |

Depende do `PLANO-PAPEIS.md` (dono do agente, quem pode pedir) e do `PLANO-REPOS.md` (lista de repos).

## 9. Testes

- YAML alterado em um byte → recusado; versão nova sem aprovação → recusada.
- Parâmetro com `; rm -rf ~` ou `../` → recusado na validação, nunca chega ao container.
- Pedido de alguém fora de `quem_pode_pedir` → recusado com motivo.
- Container não enxerga a home do dono; saída para host fora da lista é bloqueada.
- Nenhuma variável de ambiente ou arquivo do container contém chave de API (o `postinstall` de teste procura e não acha).
- Tempo máximo estourado → processo morto, auditoria registra.

## 10. Em aberto

1. Docker Desktop como pré-requisito no Windows, ou WSL?
2. Fluxos podem usar segredos (ex.: token de staging)? Proposta: não na fase 1; depois, segredo local por fluxo, nunca vindo do relay.
3. Limite de execuções simultâneas por dono.

## 11. Estudo: condicionais, laços e editor em fluxograma

Pedido do João em [370]. Até a seção 10 o fluxo é uma lista reta de passos. Aqui ele vira um **fluxograma**, com desvios e repetições, montado por interface e guardado localmente por hash. A regra central (seção 2) não muda: **só roda o que o dono aprovou, byte a byte**. Condição e laço só escolhem entre caminhos que já estavam no fluxo aprovado e nunca criam passo novo.

### 11.1 Modelo: um grafo de nós com limite

O fluxo passa a ser um grafo dirigido. O formato canônico é JSON e o YAML continua aceito na entrada.

```yaml
nome: testar-pr
versao: 4
parametros:
  repo: { tipo: escolha, de: repos_aprovados }
  pr:   { tipo: inteiro, min: 1 }
  navegadores: { tipo: lista, de: [chromium, firefox], max: 2 }
limites: { passos_max: 40, tempo_max: 20m }
nos:
  - id: clonar
    clonar: "{repo}"
    ref: "pull/{pr}/head"
    proximo: instalar
  - id: instalar
    rodar: [npm, ci]
    saidas: { codigo: inteiro }
    proximo: ok_instalar
  - id: ok_instalar
    se: "instalar.codigo == 0"
    entao: por_navegador
    senao: falhou
  - id: por_navegador
    para_cada: { item: nav, em: "params.navegadores", max: 2 }
    corpo: e2e
    depois: resumo
  - id: e2e
    rodar: [npx, playwright, test, --project, "{nav}"]
    tentar_de_novo: { vezes: 2, se: "e2e.codigo != 0" }
    saidas: { codigo: inteiro }
  - id: resumo
    agente: "Resuma os resultados dos testes em até 10 linhas."
    saidas: { veredito: { tipo: escolha, de: [aprovado, ajustes, bloqueado] } }
    proximo: fim
  - id: falhou
    falhar: "npm ci falhou"
  - id: fim
    terminar: true
layout: { clonar: [0, 0], instalar: [0, 120] }   # posições do editor, fora do hash
```

**Tipos de nó**

| Nó | Faz | Limite |
|---|---|---|
| `clonar`, `rodar`, `servir`, `agente` | os passos da seção 3 | os de lá |
| `se` | desvia por uma condição (`entao` / `senao`) | os dois ramos são obrigatórios |
| `escolher` | desvia por um valor `escolha` (um ramo por opção + `padrao`) | opções fechadas |
| `para_cada` | repete um subgrafo para cada item de uma lista | `max` obrigatório, ≤ 20 |
| `repetir_ate` | repete até a condição ser verdadeira | `max` obrigatório, ≤ 10 |
| `tentar_de_novo` | atributo de um passo, não um nó | `vezes` ≤ 3 |
| `aprovar` | pausa até o dono confirmar (Clawd ou app) | expira em 30 min |
| `falhar`, `terminar` | encerram | — |

**Não existe `enquanto` sem limite nem `ir_para` livre.** Todo ciclo do grafo sai de um nó de laço com `max`, então o pior caso é calculável antes de rodar.

### 11.2 Condições: uma linguagem pequena, sem `eval`

- Gramática fechada: comparações (`== != < <= > >=`), `e`, `ou`, `nao`, `em`, parênteses, literais (número, texto, booleano) e referências `params.x`, `<no>.<saida>` e `<laco>.indice`.
- Interpretada por um parser próprio de umas 150 linhas, com testes. Nunca passa por `eval`, Python ou shell. Na aprovação, uma referência a nó ou saída que não existe é recusada.
- **Só as saídas declaradas e tipadas** entram em condição (`saidas:`). O texto livre de um passo `agente` não entra: o agente devolve uma `escolha` fechada (`veredito`), validada pelo executor. Assim, uma injeção de prompt no código do PR pode no máximo puxar um ramo que o dono já aprovou, nunca criar um caminho.
- Condição não lê variável de ambiente, arquivo nem segredo.

### 11.3 Validação estática (antes de aprovar e de novo antes de rodar)

1. Todo nó é alcançável a partir do primeiro, e todo caminho termina em `terminar` ou `falhar`.
2. Todo ciclo passa por um nó de laço com `max`. Por enquanto não há laço aninhado mais de 2 níveis.
3. **Pior caso calculado**: o maior número de passos possível, multiplicando os `max`. Se passar de `limites.passos_max` (teto absoluto de 200), o fluxo é recusado. A tela de aprovação mostra esse número ("no pior caso: 14 passos, 20 min").
4. Parâmetros, saídas e `{interpolacoes}` referenciam coisas declaradas. A interpolação só vale dentro de argumentos de lista (seção 3), nunca para montar comando.
5. No máximo 100 nós e 64 KB por fluxo.

### 11.4 Hash e armazenamento local

- **O hash sai da forma canônica, não do texto**: JSON canônico (RFC 8785, JCS) do fluxo **sem** `layout`. Assim, reindentar o YAML ou arrastar caixinhas no editor não pede nova aprovação, mas mudar um argumento, uma condição ou uma seta pede.
- Pasta endereçada por conteúdo, no PC do dono:
  ```
  ~/.relay/fluxos/
    objetos/sha256/ab/abcd….json   # forma canônica, somente leitura
    aprovados.json                  # {nome, versao, sha256, quem_pode_pedir, modo, aprovado_em}
    layout/<sha256>.json            # posições do editor (não confiável, só visual)
    auditoria/<data>-<id>.json
  ```
  O nome do arquivo é o próprio hash: o executor recalcula ao abrir, e se não bater, o arquivo é apagado e baixado de novo. O `aprovados.json` guarda também o próprio hash num arquivo vizinho, para detectar edição fora do executor.
- **Baixar uma vez, rodar offline**: o executor roda o objeto local aprovado. O relay só manda o pedido (nome, versão, parâmetros), e o executor nem consulta o catálogo para executar. Se o relay for comprometido, o fluxo continua o mesmo.
- **Depois (fase 6)**: assinatura Ed25519 de quem publicou (`minisign`), para o dono saber que a versão nova veio da mesma pessoa. O hash garante que o conteúdo não mudou; a assinatura diz quem o escreveu.

### 11.5 Editor em fluxograma (web; app só visualiza)

- Biblioteca: **React Flow (`@xyflow/react`)**. É MIT, feita para editor de nós, tem setas, zoom, minimapa e layout salvo, e fica leve no bundle do Vite. Layout automático com `elkjs` no botão "organizar".
- **Paleta** com os tipos de nó; arrastar para o quadro; ligar saindo das portas (`entao`/`senao` são portas diferentes, coloridas).
- **Painel do nó** com formulário tipado em vez de texto livre: `rodar` monta a lista de argumentos em chips; `se` tem um **construtor de condição** com listas suspensas (saída › operador › valor) e um modo texto opcional, validado ao digitar.
- **Validação ao vivo** (11.3) com o erro marcado no nó, mais o contador de pior caso no rodapé.
- **Simular**: roda o grafo com saídas falsas escolhidas na mão (ex.: `instalar.codigo = 1`) e acende o caminho. Não executa nada.
- **Ver como YAML**, nos dois sentidos, e **Publicar** (`POST /fluxos`). Publicar não aprova (seção 4).
- **Tela de aprovação (executor/Clawd)**: o fluxograma com **diff visual** contra a versão aprovada (nó novo em verde, alterado em amarelo, seta removida tracejada), o diff textual da forma canônica e o pior caso. Aprovar continua sendo **no PC do dono**: o web só mostra.

### 11.6 Execução: máquina de estados

- O executor percorre o grafo nó a nó. Cada transição vai para a auditoria (`no`, `entrada`, `saida`, `ramo_escolhido`, `duracao`), e a tela de "revisar depois" redesenha o fluxograma com o caminho que rodou.
- Contadores globais de passos e tempo são checados a cada nó, além dos `max` de cada laço. Se estourar, o executor mata o container e registra.
- Na fase 1 não há retomada: se o executor cair no meio, a execução é marcada como `interrompida` e precisa de um novo pedido.

### 11.7 Testes novos

- Ciclo sem nó de laço → recusado; `para_cada` sem `max` → recusado; pior caso acima do limite → recusado com o número.
- Condição com `__import__`, `;`, crase ou referência inexistente → recusada no parser.
- Agente devolvendo um `veredito` fora das opções → o passo falha, e nenhum ramo é escolhido.
- Mudar só o `layout` mantém o hash; mudar uma condição muda o hash e pede aprovação.
- Objeto local adulterado → detectado ao abrir, rebaixado ou recusado.
- Simular não cria container nem processo.

### 11.8 Fases (encaixam no plano da seção 8)

| Fase | Entrega |
|---|---|
| 1b | Modelo de grafo + parser de condição + validação estática + hash canônico (só back e executor, sem tela) |
| 2b | Editor React Flow no web: montar, validar, simular, publicar |
| 3b | Tela de aprovação com diff visual; auditoria com caminho percorrido |
| 6 | Assinatura do publicador |

Divisão: back, executor e parser comigo; editor e telas com o Lume.

### 11.9 Em aberto

1. Paralelismo (dois ramos ao mesmo tempo): fica de fora até a fase 3b, porque complica a auditoria e os limites.
2. Subfluxos (um fluxo chamar outro aprovado pelo hash): úteis, mas cada um somaria o pior caso do outro. Proposta: depois da fase 3b.
3. Saídas de arquivo (`relatorio.md`) entram em condição só por existência/tamanho, nunca pelo conteúdo?
