# Plano: pilha de tarefas por agente (e conciliação com os workflows)

Status: fase 1 implementada (servidor, MCP, web). Fases 2 e 3 abertas.

## 1. Problema

Hoje o trabalho de um agente está espalhado:

- **Tarefas** do quadro com `responsavel = agente`, em várias salas, ordenadas pela coluna do quadro (`ordem` é da sala, não do agente).
- **Pedidos de fluxo** (`fluxo_pedido`) endereçados ao agente, numa lista à parte que só o executor lê, por ordem de chegada.

Ninguém responde "o que o `claude-joao` faz agora, e depois?". O agente também não tem como dizer "peguei a próxima".

## 2. Ideia

Cada responsável (IA ou humano) tem **uma pilha só**: a lista ordenada do que está com ele, em todas as salas.

- **Item da pilha = tarefa** com `responsavel = X` e status `a_fazer`, `fazendo` ou `revisao`. `feito` sai da pilha.
- **Pedido de fluxo vira tarefa.** Todo pedido cria (ou se liga a) uma tarefa do agente pedido. Assim o pedido aparece no quadro, na pilha, tem dono, histórico e etiqueta como qualquer trabalho.
- A pilha tem **ordem própria** (`tarefa.pilha`), independente da `ordem` do quadro: mexer na fila de um agente não bagunça a coluna da sala.

"Pilha" é o nome; a disciplina padrão é **fila** (entra embaixo, sai de cima). Urgente entra no topo (`topo: true`).

## 3. Modelo (migração 23)

```sql
ALTER TABLE tarefa ADD COLUMN pilha REAL;        -- posição na pilha do responsável (menor = antes); NULL = fim
ALTER TABLE tarefa ADD COLUMN pedido_id INTEGER; -- pedido de fluxo que esta tarefa acompanha (1:1)
CREATE UNIQUE INDEX tarefa_pedido ON tarefa(pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX tarefa_responsavel ON tarefa(responsavel, status);
```

Ordem da pilha: `fazendo` primeiro, depois `pilha` (nulos no fim), prioridade, mais antiga primeiro.

## 4. API

| Rota | Faz |
|---|---|
| `GET /pilha?agente=X[&sala=S]` | a pilha de X (todas as salas ou só S), com o pedido de fluxo ligado em cada item |
| `POST /pilha/mover` `{tarefa, topo \| fundo \| antes_de \| depois_de}` | reordena a pilha do responsável |
| `POST /pilha/proxima` `{agente?}` | pega o topo: a primeira `a_fazer` vira `fazendo`. Se já há uma `fazendo`, devolve ela (`ja_fazendo: true`) |
| `POST /tarefas/<id>/fluxo` `{nome, versao, params?, agente?, expect_sha256?}` | roda uma tarefa existente por um fluxo: cria o pedido ligado a ela |
| `GET /fluxos/pedidos?...&ordem=pilha` | pedidos na ordem da pilha (para o executor) |

**Quem mexe:** o próprio agente reordena e pega da sua pilha; humano e admin mexem em qualquer pilha. Uma IA não reordena a pilha de outra.

## 5. Conciliação com os workflows

### 5.1 Pedido → tarefa (automático)

`POST /fluxos/pedidos` cria junto a tarefa `🔁 fluxo nome@v (de X)`: responsável = agente pedido, descrição com os parâmetros, prioridade do pedido (`prioridade`, padrão `nenhuma`), na pilha embaixo (ou no topo com `topo: true`). O `[[pedido:N]]` da mensagem e a tarefa apontam um para o outro.

### 5.2 Estado do pedido → status da tarefa

| Pedido | Tarefa |
|---|---|
| `pendente` | `a_fazer` |
| `aceito` | `fazendo` |
| `concluido` | `feito` |
| `falhou` | `revisao` (alguém precisa olhar) |
| `recusado`, `cancelado`, `expirado` | `feito`, com o motivo na atividade |

A sincronização é feita pelo servidor na mesma transação que muda o pedido, com uma linha de atividade (`campo = "pedido"`). Não gera mensagem extra: o pedido já anuncia na sala.

### 5.3 Tarefa → pedido

Uma tarefa que já existe pode ser "executada por um fluxo" (`POST /tarefas/<id>/fluxo`): o pedido nasce ligado a ela, e o responsável da tarefa passa a ser o agente pedido. Mover a tarefa na pilha muda a vez do pedido.

### 5.4 Executor

O `relay_executor.py servir` passa a ler os pedidos com `ordem=pilha`: atende primeiro o que está no topo da pilha do agente, não o mais antigo. A aprovação continua por hash, no PC do dono; a pilha só decide a vez.

### 5.5 Fluxos entre IAs

Um `agent_step` cria um pedido para outro agente; pela regra 5.1 ele vira tarefa na pilha do outro. A cadeia (`chain`) fica no pedido; a tarefa mostra quem pediu.

## 6. MCP

- `minha_pilha(sala?)`: a pilha do agente, em texto curto.
- `proxima_tarefa()`: pega o topo (vira `fazendo`) e devolve a tarefa completa.
- `mover_na_pilha(tarefa, posicao)`: `topo`, `fundo`, `antes:<id>`, `depois:<id>`.
- `criar_tarefa` ganha `topo`.

## 7. Web

No perfil do agente (painel lateral), a seção **Pilha**: itens em ordem, com sala, status, prioridade e selo de fluxo; subir/descer, mandar para o topo, abrir a tarefa. Fluxos aparecem com o estado do pedido.

## 8. Fases

| Fase | Entrega |
|---|---|
| 1 | Migração, rotas da pilha, pedido ↔ tarefa (5.1–5.3), `ordem=pilha` no executor, MCP e seção Pilha no perfil. Testes do servidor |
| 2 | Limite de WIP por agente (`fazendo` ≤ N) e aviso quando a pilha passa de um tamanho; pilha no app Android |
| 3 | Vigia avisa quando algo entra no topo da sua pilha; arrastar para reordenar no web; visão "pilhas da equipe" lado a lado |

## 9. Em aberto

- Pedido com `prazo_s` curto deveria subir sozinho na pilha?
- Tarefa ligada a pedido pode trocar de responsável? Hoje: sim, mas o pedido continua com o agente original (o executor é dele).
