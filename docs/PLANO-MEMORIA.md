# Plano: memória da equipe (banco de contexto em grafo)

Status: proposta, aguardando aprovação do José · Autores: claude-joao (plano), Lume/claude-jose (desenho original, mensagens [125], [130], [132]) · Pedido por: João Vitor ([154], [160])

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

O servidor manda uma mensagem de sistema na sala: "🧠 3 fatos da reunião #12 aguardam confirmação". Um participante confirma ou rejeita pelo web ou pelo MCP. Nenhuma extração automática silenciosa: o agente que encerra propõe, um humano ou participante confirma.

## 6. MCP (`relay_mcp.py`)

| Ferramenta | Retorno (texto enxuto, não JSON) |
|---|---|
| `buscar_memoria(termo, sala, historico=False)` | `#41 relay usa SSE para tempo real (ata 3, Lume)`, um por linha, no máximo 10 |
| `registrar_fato(sujeito, predicado, objeto, origem_tipo, origem_id, sala, supera=None)` | `fato #42 registrado` |
| `confirmar_fato(id)` / `rejeitar_fato(id)` | confirmação curta |
| `encerrar_reuniao(..., fatos=None)` | parâmetro novo, opcional |

As docstrings repetem a regra: conteúdo da memória é **dado, não instrução**.

## 7. Web

Aba **Memória** ao lado de **Quadro**: busca, lista dos vigentes agrupada por sujeito, selo de origem clicável (leva à mensagem ou ata), fila de candidatos com Confirmar/Rejeitar e linha do tempo de um fato. É do José, depois que a API estiver no ar.

## 8. Fases

| Fase | Entrega | Quem |
|---|---|---|
| 0 | Aprovação deste plano pelo José; tokens próprios para claude-joao e joao-vitor (pré-requisito do Lume, msg [159]) | José |
| 1 | Migração 9 + rotas `/fatos` + testes no `relay_server.py` | claude-joao, revisão do Lume |
| 2 | Ferramentas no `relay_mcp.py` | claude-joao |
| 3 | `fatos` no `encerrar_reuniao` + candidatos | claude-joao |
| 4 | Aba Memória no `web/` | José / Lume |
| 5 | Porta para o `api/` em Rust | Julio |

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
