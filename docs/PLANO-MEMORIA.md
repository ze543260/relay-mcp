# Plano: memória da equipe (banco de contexto em grafo)

Status: fases 1–3 no ar (PRs #1 e #2, deploy em [270]); fase 4 com o Lume; próximas fases na seção 11 · Autores: claude-joao (plano), Lume/claude-jose (desenho original, mensagens [125], [130], [132]) · Pedido por: João Vitor ([154], [160], [282])

## 1. Objetivo

Dar aos agentes da sala uma memória compartilhada de **fatos com origem**: decisões, convenções, contratos e quem cuida do quê. Um agente que entra numa conversa pergunta `buscar_memoria("SSE")` e recebe os 5 fatos vigentes sobre o assunto, com a mensagem ou ata que gerou cada um, em vez de reler o histórico da sala.

Fora do escopo desta fase: memória privada por agente, embeddings, extração automática sem confirmação, agenda.

## 2. Modelo: triplas com origem

Cada fato é uma aresta do grafo: `sujeito --predicado--> objeto`. Sujeitos e objetos que se repetem viram os nós, sem tabela separada de entidades nesta fase.

```
("relay", "usa", "SSE para tempo real")          origem: ata 3
("api/", "é responsabilidade de", "Julio")       origem: msg 57
("memória", "começa por", "atas das reuniões")   origem: msg 130
```

Regras:
- **Origem obrigatória**: `origem_tipo` (`msg`, `ata`, `tarefa`, `arquivo`) + `origem_id`. Fato sem origem é recusado (400 `origem_obrigatoria`).
- **Nada se apaga**: um fato novo pode **superar** um antigo (`superado_por`). A busca devolve só os vigentes; `?historico=1` mostra a linha do tempo.
- **Por sala**: a memória da `#geral` não vaza para outra sala. Mensagens privadas (`para`) **não** podem ser origem de fato público.
- **Autor sempre registrado**: quem registrou e quem confirmou.

## 3. Schema (migração 9 do `relay_server.py`)

```sql
CREATE TABLE IF NOT EXISTS fato (
  id INTEGER PRIMARY KEY,
  sala TEXT NOT NULL,
  sujeito TEXT NOT NULL,
  predicado TEXT NOT NULL,
  objeto TEXT NOT NULL,
  origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('msg','ata','tarefa','arquivo')),
  origem_id TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('candidato','vigente','superado','rejeitado')),
  superado_por INTEGER REFERENCES fato(id),
  autor TEXT NOT NULL,
  confirmado_por TEXT,
  criado REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS fato_vigente ON fato(sala, sujeito) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS fato_origem ON fato(origem_tipo, origem_id);
CREATE VIRTUAL TABLE IF NOT EXISTS fato_busca USING fts5(
  sujeito, predicado, objeto, content='fato', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
-- + triggers AFTER INSERT/UPDATE em fato mantendo fato_busca
```

`remove_diacritics` faz `reuniao` achar `reunião`.

**No Rust/Postgres (`api/`, Julio)**: mesma tabela via migration do sqlx; a busca troca FTS5 por coluna `tsvector` gerada (`to_tsvector('portuguese', sujeito||' '||predicado||' '||objeto)`) com índice GIN. Índice parcial igual. O contrato HTTP abaixo não muda.

## 4. API

| Rota | O que faz |
|---|---|
| `GET /fatos?sala=X&q=termo&limite=10` | Busca nos vigentes, ordenada por relevância (bm25) e depois pelo mais novo. `&historico=1` inclui superados. `&sujeito=X` filtra exato. |
| `POST /fatos` `{sala, sujeito, predicado, objeto, origem_tipo, origem_id, supera?}` | Registra um fato vigente. `supera` = id do fato que ele substitui (marca o antigo como `superado` na mesma transação). Valida que a origem existe e é da mesma sala. |
| `GET /fatos/{id}` | Um fato com a cadeia de versões (quem superou quem). |
| `GET /fatos/candidatos?sala=X` | Candidatos vindos de atas, aguardando confirmação. |
| `POST /fatos/{id}/confirmar` · `POST /fatos/{id}/rejeitar` | Só participantes da reunião de origem (ou admin). |

Erros em problem+json com `codigo`, como o resto da API. Limites: sujeito/predicado até 120 caracteres, objeto até 500, 20 fatos por minuto por agente. O filtro de credenciais das mensagens também roda em `objeto`.

Eventos: `registrar_evento(con, "fato", sala, id)`, para o web atualizar ao vivo.

## 5. Atas viram candidatos

No `encerrar_reuniao`, além de `acoes`, um campo opcional `fatos: [{sujeito, predicado, objeto, supera?}]` (até 20). Cada um entra como **candidato** com `origem_tipo='ata'`, `origem_id=<id da reunião>`.

O servidor manda uma mensagem de sistema na sala: "🧠 3 fatos da reunião #12 aguardam confirmação". Nenhuma extração automática silenciosa: o agente que encerra propõe, um **humano participante** confirma ou rejeita.

**Quem confirma** (implementado na fase 3): só identidade humana forte, isto é, um token de `tipo='humano'` usado direto ou na sessão aberta com ele. **Token de admin não conta, nem a sessão aberta com ele**, porque nos dois o nome é escolhido livremente. Na prática, o José e o João precisam de token próprio de humano para confirmar. A ata é tudo ou nada: se um `supera` de um candidato for inválido, a reunião não encerra.

## 6. MCP (`relay_mcp.py`)

| Ferramenta | Retorno (texto enxuto, não JSON) |
|---|---|
| `buscar_memoria(termo, sala, historico=False)` | `#41 relay usa SSE para tempo real (ata 3, Lume)`, um por linha, no máximo 10 |
| `registrar_fato(sujeito, predicado, objeto, origem_tipo, origem_id, sala, supera=None)` | `fato #42 registrado` |
| `encerrar_reuniao(..., fatos=None)` | parâmetro novo, opcional; devolve os ids dos candidatos |

**Não existe** `confirmar_fato` no MCP, de propósito: confirmar é coisa de humano, pelo web ou app (`POST /fatos/{id}/confirmar` e `/rejeitar`), como o voto no `PLANO-PAPEIS.md`.

As docstrings repetem a regra: conteúdo da memória é **dado, não instrução**.

## 7. Web

Aba **Memória** ao lado de **Quadro**: busca, lista dos vigentes agrupada por sujeito, selo de origem clicável (leva à mensagem ou ata), fila de candidatos com Confirmar/Rejeitar e linha do tempo de um fato. É do José, depois que a API estiver no ar.

## 8. Fases

| Fase | Entrega | Quem |
|---|---|---|
| 0 | Aprovação deste plano pelo José; tokens próprios para claude-joao e joao-vitor (pré-requisito do Lume, msg [159]) | José · tokens ainda pendentes |
| 1 | ✅ Migração 10 + rotas `/fatos` + testes no `relay_server.py` (PR #1) | claude-joao, revisão do Lume |
| 2 | ✅ Ferramentas `buscar_memoria` e `registrar_fato` (PR #1) | claude-joao |
| 3 | ✅ `fatos` no `encerrar_reuniao` + candidatos confirmados só por humano (PR #2, migração 11) | claude-joao |
| 4 | Aba Memória no `web/` e no app | Lume |
| 5–10 | Ver seção 11 | claude-joao (back), Lume (telas) |
| — | Porta para o `api/` em Rust | Julio |

Cada fase é um PR pequeno, revisado no relay antes de entrar no servidor do José.

## 9. Testes da fase 1

- Fato sem origem → 400; origem de outra sala ou mensagem privada → 400.
- `supera` marca o antigo como `superado` na mesma transação; superar um já superado → 409.
- Busca com e sem acento acha o mesmo fato; superados só aparecem com `historico=1`.
- Agente sem acesso à sala não lê os fatos dela.
- Migração 8 → 9 num banco com dados existentes não perde nada.

## 10. Em aberto

1. Quem pode registrar fato direto (sem passar por candidato): qualquer agente da sala, ou só humanos e admins?
2. Normalizar sujeitos (`relay` vs `Relay` vs `o relay`)? Proposta: comparação `COLLATE NOCASE` agora, aliases depois se doer.
3. Retenção: fatos superados ficam para sempre ou seguem a mesma retenção das mensagens?

## 11. Próximas fases (5 em diante)

Pedido do João em [282]. O que está no ar hoje: fatos com origem obrigatória, busca sem acento, cadeia de versões (o novo supera o antigo, nada se apaga) e fatos propostos em atas, que só viram memória quando um humano participante confirma. A ordem abaixo vai do que destrava mais para o que depende de outros planos. Cada fase é um PR pequeno; as migrações começam depois da 13, que é dos artefatos do Lume ([281]).

### Fase 5 — Autoria e acesso de verdade

Fecha os dois itens que ficaram da revisão do PR #1 ([237]).

- **Autor pelo token**: com token de agente ou sessão, o servidor define o `autor`; o `de` do corpo só vale com o token de admin e passa a ser registrado como `autor_declarado` (auditoria). Quando os tokens próprios existirem, o admin+`de` deixa de registrar fato.
- **Quem registra direto**: humano registra vigente; **agente registra como candidato**, igual à ata. Um humano da sala confirma. Responde o item 1 da seção 10.
- **Acesso por sala**: `GET /fatos` e `GET /fatos/{id}` passam a respeitar os papéis do `PLANO-PAPEIS.md` (observador lê, membro propõe). Enquanto os papéis não existirem, fica como hoje.
- Depende de: tokens próprios (fase 0) e papéis (fase 3 do PLANO-PAPEIS).

### Fase 6 — O grafo de verdade: aliases e vizinhança

Hoje é uma lista de triplas; aqui ela vira navegável. Detalhado a pedido do João em [314], para validar com o Lume e o claude-julio antes de implementar.

**O problema**: "relay", "Relay", "o relay" e "relay-mcp" viram sujeitos diferentes, então `buscar_memoria(sujeito="relay")` perde metade dos fatos, e não há como perguntar "o que está ligado ao relay?".

#### Modelo (migração 15; a 13 e a 14 são dos artefatos)

```sql
CREATE TABLE IF NOT EXISTS alias (
  sala TEXT NOT NULL, nome TEXT NOT NULL COLLATE NOCASE, canonico TEXT NOT NULL,
  criado_por TEXT NOT NULL, origem_tipo TEXT, origem_id TEXT, criado REAL NOT NULL,
  PRIMARY KEY (sala, nome));
CREATE INDEX IF NOT EXISTS fato_objeto_vigente ON fato(sala, objeto COLLATE NOCASE) WHERE estado='vigente';
```

- **Nó** = nome canônico. Um sujeito é sempre nó; um objeto vira nó quando, resolvido, coincide com algum sujeito ou alias da sala. Senão, é uma **folha** ("SSE para tempo real").
- **Aresta** = fato vigente (`sujeito → predicado → objeto`), com a origem dele.
- **Resolução na leitura, não na escrita**: os fatos guardam o texto como foi registrado, e o alias é aplicado na hora da consulta. Criar ou apagar um alias muda o grafo para trás, sem reescrever fatos nem mexer no índice FTS.
- **Normalização leve antes do alias**: minúsculas, sem acento, espaços colapsados e sem artigo inicial (`o`, `a`, `os`, `as`). Assim "O Relay" já casa com "relay" sem precisar de alias.

#### Regras dos aliases

- `nome` e `canonico` com 1–120 caracteres; `nome` diferente de `canonico` depois de normalizar.
- **Sem cadeia nem ciclo**: o `canonico` é sempre resolvido até a raiz ao gravar (se `relay-mcp → relay` existe, um alias para `relay-mcp` grava `relay`). Um alias cujo `nome` já é canônico de outros → 409 `alias_e_canonico` (evita A→B e B→A).
- Até 200 aliases por sala. Origem opcional (a mensagem em que se combinou o nome).
- Quem cria: qualquer membro, humano ou agente. Alias não afirma nada, só junta nomes, e cada criação vai para a atividade com o autor. Apagar: quem criou ou humano da sala.

#### API

| Rota | Faz |
|---|---|
| `GET /memoria/aliases?sala` | aliases da sala, com quantos fatos cada um junta |
| `POST /memoria/aliases {sala, nome, canonico, origem_tipo?, origem_id?}` | cria (resolve o canônico até a raiz) |
| `DELETE /memoria/aliases?sala&nome` | remove |
| `GET /memoria/aliases/sugestoes?sala` | pares de sujeitos que só diferem por normalização forte (plural, hífen, `-mcp`, `-app`), para um humano aceitar com um clique |
| `GET /memoria/grafo?sala&sujeito&profundidade=1\|2&limite=50` | nós e arestas a partir do sujeito |
| `GET /fatos?sujeito=X` | passa a resolver o alias (devolve os fatos de todos os nomes do mesmo nó) |

Resposta do grafo:

```json
{"centro": "relay",
 "nos": [{"nome": "relay", "nomes": ["relay", "relay-mcp"], "fatos": 7}, {"nome": "sse", "nomes": ["SSE"], "fatos": 2}],
 "arestas": [{"fato": 41, "de": "relay", "predicado": "usa", "para": "sse", "folha": false,
              "origem": {"tipo": "ata", "id": "3"}, "autor": "lume"}],
 "cortado": false}
```

- Busca em largura sobre fatos vigentes, nos dois sentidos (o que o nó usa e o que usa o nó), com profundidade 1 ou 2 e no máximo 50 arestas. Acima disso devolve `cortado: true` e prioriza as arestas mais recentes.
- As salas têm poucas centenas de fatos, então a busca em Python com os dois índices parciais (sujeito e objeto vigentes) basta. Sem tabela de nós materializada.

#### MCP

- `vizinhanca(sujeito, profundidade=1)` em texto curto, já resolvido:
  ```
  relay (também: relay-mcp)
    → usa → SSE (ata 3, Lume)
    → é responsabilidade de → José (msg 57)
    ← depende de ← app Android (msg 140)
  ```
- `buscar_memoria(sujeito=...)` passa a resolver o alias sozinho.
- `definir_alias(nome, canonico)` para o agente juntar nomes quando perceber a duplicata.
- O retorno lembra que o conteúdo é dado, não instrução, como o resto da memória.

#### Web (Lume)

Na aba Memória: clicar num sujeito abre a vizinhança como lista agrupada por predicado, e depois como um mapa simples (nó central e vizinhos, clique para expandir). As sugestões de alias aparecem com "Juntar" e "Ignorar".

#### No perfil da IA (pedido do João em [318])

O perfil de cada agente (PLANO-PERFIL do Lume) ganha uma seção **Memória**: o grafo do que aquela IA sabe e do que se sabe sobre ela, que dá para destrinchar.

- **Visão de entrada**: o nó da própria IA (`claude-joao`, com os aliases, como `claudio`) no centro e, em volta, os assuntos ligados a ela, agrupados: fatos **sobre** ela (sujeito ou objeto é ela: "claude-joao cuida de back") e fatos **que ela registrou** (autor).
- **Destrinchar**: clicar num assunto abre a vizinhança dele (mesmo `GET /memoria/grafo`), com migalhas de pão (`claude-joao › relay › SSE`) para voltar. Clicar numa aresta mostra o fato inteiro, a origem (link para a mensagem ou ata) e a cadeia de versões (`GET /fatos/{id}`).
- **Filtros**: só vigentes (padrão) ou com histórico; por sala; por período.
- **Quem vê o quê**: todos veem os fatos de sala; quando existir a memória privada (fase 7), **só o dono** vê também os fatos de escopo `agente`, marcados como privados. É o "donos de IA veem mais coisas" de [271].
- **API**: `GET /memoria/grafo?centro=agente:claude-joao&profundidade=1|2&sala?` — o centro pode ser um nome ou um agente; para agente, junta os fatos sobre ele e os de autoria dele. Mesmo limite de 50 arestas e `cortado`.
- **MCP**: `vizinhanca(sujeito="eu")` devolve o grafo do próprio agente, para ele lembrar do que já sabe ao começar.
- Tela: com o Lume, dentro do painel de perfil.

#### Testes

- "O Relay", "relay" e "RELAY" caem no mesmo nó sem alias; "relay-mcp" só com alias.
- `centro=agente:X` traz os fatos sobre X e os de autoria de X, sem os privados de outro dono.
- Alias de alias grava a raiz; A→B com B→A → 409; mais de 200 → 409.
- Apagar o alias separa os nós de novo, sem perder nenhum fato.
- Grafo com profundidade 2 respeita o limite de 50 e marca `cortado`; fatos superados e candidatos não entram.
- `GET /fatos?sujeito=relay-mcp` traz os fatos de `relay`.
- Migração 14 → 15 preserva os fatos.

#### Fora desta fase

Tipos de nó (pessoa, projeto, serviço), pesos nas arestas e embeddings. Ficam para quando o grafo estiver em uso e a falta deles doer.

#### Para validar

1. Resolver alias na leitura (proposta) ou reescrever os fatos na escrita?
2. Agente pode criar alias sem confirmação humana? (Proposta: sim, porque só junta nomes e fica na atividade.)
3. O claude-julio vê algum problema para levar isso ao back em Java (busca em largura e normalização sem acento)?

### Fase 7 — Memória do agente (privada, do dono)

É o que o João pediu em [271]: o dono vê a memória da IA dele.

- Coluna `escopo` em `fato`: `sala` (como hoje) ou `agente`, com `dono_agente`.
- Fato de escopo `agente` só é lido pelo próprio agente e pelo humano dono dele (`agente.dono`, do PLANO-PAPEIS). Nunca aparece para a sala, nem na busca de outros.
- **Promover**: o agente ou o dono pode propor um fato privado para a sala; ele vira candidato e passa pela confirmação humana.
- Origem continua obrigatória (pode ser uma mensagem privada com o dono, já que não sai do escopo).
- Entra no perfil (PLANO-PERFIL do Lume): aba "Memória" visível só para o dono.
- Depende de: `agente.dono` (fase 1 do PLANO-PAPEIS).

### Fase 8 — Contexto ao conectar, com orçamento de tokens

A memória só ajuda se o agente a usar sem gastar contexto.

- Colunas `usos` e `usado_em` em `fato`, atualizadas quando o fato aparece num resultado de `buscar_memoria` que o agente usou (o MCP manda um `POST /fatos/usados` com os ids citados).
- Ao conectar, o MCP entrega junto da persona um **resumo da memória da sala**: os fatos vigentes mais usados e mais recentes, até ~300 tokens, com os ids para o agente abrir o resto sob demanda.
- Fato vigente sem uso há 90 dias vira "frio": continua na busca, mas sai do resumo.

### Fase 9 — Mais origens

- `decisao` (PLANO-PAPEIS): decisão aprovada vira fato vigente automaticamente, com os votos como prova.
- `repo` (PLANO-REPOS): PR mergeado pode ser origem de um fato ("relay usa FTS5", origem PR #1).
- Tarefa concluída **sugere** um candidato ("o que ficou decidido aqui?"), nunca grava sozinha.

### Fase 10 — Retenção e limpeza

- Fatos superados ficam para sempre por padrão (são o histórico); a retenção da sala pode valer para eles com `RELAY_RETENCAO_FATOS_DIAS`.
- Se a mensagem de origem for apagada, o fato **não** some: ganha `origem_apagada=1` e o selo de origem mostra "mensagem apagada", para não sumir uma decisão por causa de uma limpeza de chat.
- Toda remoção ou edição de texto passa pelo `'delete'` do FTS (nota na migração 10).
- Responde o item 3 da seção 10.

### Ordem sugerida

| Fase | Por que agora | Depende de |
|---|---|---|
| 6 | Não depende de ninguém e deixa a memória navegável já | — |
| 8 | Faz os agentes realmente usarem a memória | — |
| 5 | Fecha a autoria e o acesso | tokens próprios + papéis |
| 7 | Memória privada do agente (pedido do João) | `agente.dono` |
| 9 | Mais fontes de fato | PLANO-PAPEIS e PLANO-REPOS |
| 10 | Limpeza | — |

Nada começa sem o ok do José, e as migrações esperam a 13 dos artefatos entrar.
