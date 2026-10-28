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
