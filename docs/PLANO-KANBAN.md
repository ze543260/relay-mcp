# Plano: kanban mais rico

Status: proposta, aguardando aprovação do José · Autor: Lume (claude-jose) · Pedido por: João ([178])
Base atual: tarefas com título, descrição curta, status (`a_fazer → fazendo → revisao → feito`), responsável, sprint e mensagem de origem (`relay_server.py`, migração 4).

## 1. O que entra (comparado a Linear, Jira, GitHub Projects e Trello)

| Recurso | Por quê | Fase |
|---|---|---|
| **Descrição em Markdown** (até 20 KB) com o mesmo render das mensagens | Contexto da tarefa sem ir pro chat | 1 |
| **Prioridade** (`urgente`, `alta`, `media`, `baixa`, `nenhuma`) | Ordenar a fila de cada um | 1 |
| **Etiquetas** por sala (nome + cor dos tokens `agentes`) | Filtrar por área (front, back, infra) | 1 |
| **Prazo** e **estimativa** (pontos 1, 2, 3, 5, 8) | Sprint com capacidade e atraso visível | 1 |
| **Checklist** (itens marcáveis) | Subpassos sem criar tarefa | 1 |
| **Relações**: bloqueia ↔ bloqueada por, relacionada, duplicada de, **subtarefa de** | Dependências e épicos; avisa quando a bloqueadora fecha | 2 |
| **Anexos** (reusa `arquivo`, com `tarefa_id`) | Prints, specs, logs junto da tarefa | 2 |
| **Comentários** (thread da tarefa) e **histórico de atividade** | Discussão e auditoria sem poluir a sala | 2 |
| **Repositórios e PRs relacionados** (tabelas `repo`/`mencao_repo` do plano de repositórios) | PR mergeado → tarefa vai pra "feito" (opcional) | 3 |
| **Observadores** (além do responsável) | Quem quer ser avisado | 3 |
| **Visões**: quadro, **lista** com ordenação, **minha fila**, filtros salvos | Cada um trabalha do seu jeito | 3 |
| **Limite de WIP** por coluna | Evita "fazendo" infinito | 3 |
| **Modelos** de tarefa (bug, feature, pesquisa) | Descrição já estruturada | 4 |

Fora do escopo: automações tipo "se X então Y" genéricas, time tracking, campos customizados livres.

## 2. Modelo de dados (migração do `relay_server.py`; o `api/` em Rust segue o mesmo contrato)

```sql
ALTER TABLE tarefa ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'nenhuma';
ALTER TABLE tarefa ADD COLUMN estimativa INTEGER;          -- pontos
ALTER TABLE tarefa ADD COLUMN pai_id INTEGER REFERENCES tarefa(id);  -- subtarefa
ALTER TABLE tarefa ADD COLUMN ordem REAL;                   -- posição na coluna (drag & drop)
-- prazo e descricao já existem

CREATE TABLE etiqueta (id INTEGER PRIMARY KEY, sala TEXT NOT NULL, nome TEXT NOT NULL, cor INTEGER NOT NULL,
                       UNIQUE (sala, nome COLLATE NOCASE));
CREATE TABLE tarefa_etiqueta (tarefa_id INTEGER, etiqueta_id INTEGER, PRIMARY KEY (tarefa_id, etiqueta_id));

CREATE TABLE checklist (id INTEGER PRIMARY KEY, tarefa_id INTEGER NOT NULL, texto TEXT NOT NULL,
                        feito INTEGER NOT NULL DEFAULT 0, ordem REAL NOT NULL);

CREATE TABLE relacao (de_id INTEGER NOT NULL, para_id INTEGER NOT NULL,
                      tipo TEXT NOT NULL CHECK (tipo IN ('bloqueia','relacionada','duplicada')),
                      PRIMARY KEY (de_id, para_id, tipo));        -- "bloqueada por" = inverso de "bloqueia"

CREATE TABLE comentario (id INTEGER PRIMARY KEY, tarefa_id INTEGER NOT NULL, de TEXT NOT NULL,
                         texto TEXT NOT NULL, criado REAL NOT NULL);
CREATE TABLE atividade (id INTEGER PRIMARY KEY, tarefa_id INTEGER NOT NULL, de TEXT NOT NULL,
                        campo TEXT NOT NULL, antes TEXT, depois TEXT, quando REAL NOT NULL);
CREATE TABLE observador (tarefa_id INTEGER, nome TEXT, PRIMARY KEY (tarefa_id, nome));

ALTER TABLE arquivo ADD COLUMN tarefa_id INTEGER;            -- anexo de tarefa (além de msg_id)
```

Regras: ciclo em "bloqueia" ou em "subtarefa de" → 409 `ciclo`; subtarefa só na mesma sala; profundidade máxima 3.

## 3. API

| Rota | Função |
|---|---|
| `GET /tarefas?sala&status&etiqueta&responsavel&prioridade&q` | Filtros + busca (FTS5 em título/descrição) |
| `GET /tarefas/{id}` | Tarefa completa: etiquetas, checklist, relações, subtarefas, anexos, comentários, atividade |
| `PATCH /tarefas/{id}` | + `prioridade`, `estimativa`, `prazo`, `pai_id`, `ordem`, `etiquetas[]` |
| `POST/PATCH/DELETE /tarefas/{id}/checklist[/{item}]` | Itens |
| `POST/DELETE /tarefas/{id}/relacoes` | `{para_id, tipo}` |
| `POST /tarefas/{id}/comentarios` | Thread (aceita `anexos`, como mensagem) |
| `GET/POST/DELETE /etiquetas?sala` | Etiquetas da sala |

Eventos SSE: `tarefa` (já existe) com `{id, campos}`, pra atualizar só o cartão. Toda mudança gera linha em `atividade`; na sala só vão eventos relevantes (criada, pegou, revisão, concluída, desbloqueada).

## 4. MCP

`listar_tarefas` ganha filtros (`prioridade`, `etiqueta`, `bloqueadas`); novas: `ver_tarefa(id)` (texto enxuto com checklist e relações), `comentar_tarefa`, `marcar_item(id, item)`, `relacionar_tarefas(de, para, tipo)`, `minha_fila()` (minhas abertas por prioridade e prazo, sem as bloqueadas).

## 5. Interface

- **Cartão**: prioridade (ícone), etiquetas (pontos de cor), progresso do checklist (`3/5`), contadores de anexos/comentários, prazo (vermelho se vencido), cadeado se bloqueada.
- **Painel da tarefa** (abre ao clicar; no celular, tela cheia): descrição em Markdown editável, checklist, relações e subtarefas, anexos com 📎/arrastar, comentários com `@`, atividade recolhida, repositórios/PRs.
- **Arrastar e soltar** entre colunas e dentro da coluna (`ordem` fracionária, sem renumerar).
- **Visões**: Quadro · Lista (ordenável) · Minha fila. Filtros na URL (`/s/geral?aba=quadro&etiqueta=front`).
- **App Android**: lista + painel da tarefa primeiro; quadro com rolagem lateral depois.
- Tudo com os tokens do Relay DS e o guia `/ds` atualizado com os estados novos.

## 6. Fases

| Fase | Entrega |
|---|---|
| 0 | Aprovação do José |
| 1 | Prioridade, etiquetas, prazo, estimativa, checklist, descrição Markdown, painel da tarefa (web) |
| 2 | Relações e subtarefas, anexos, comentários, atividade |
| 3 | Repos/PRs (depende do plano de repositórios), observadores, visões lista/minha fila, WIP, arrastar e soltar |
| 4 | Modelos de tarefa, app Android completo |

## 7. Em aberto

1. Responsável único (como hoje) ou múltiplos? Proposta: único + observadores.
2. PR mergeado move a tarefa pra "feito" sozinho, ou só sugere?
3. Comentários da tarefa também aparecem na sala? Proposta: não; só os eventos relevantes.
