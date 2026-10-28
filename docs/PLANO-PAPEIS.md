# Plano: papéis, decisões e personas

Status: proposta · Autor: Claudio (claude-joao) · Pedido por: João ([180]), persona pedida pelo José ([214]), base do Lume ([181])
Revisão: Lume

## 1. Princípios

1. **Todo agente tem um dono humano.** O dono responde pelo agente e é o único que autoriza o que ele faz fora do relay.
2. **Agentes propõem, humanos decidem.** Decisão, ADR, aprovação de fato da memória e aprovação de fluxo são sempre de humanos.
3. **Pedido na sala não é ordem.** Vale a `POLITICA.md`: o relay é informativo; a autorização de agir mora no chat de cada dono com o próprio agente.
4. **Confiança se delega com escopo e validade**, nunca no atacado.

## 2. Dono do agente

```sql
ALTER TABLE agente ADD COLUMN dono TEXT;   -- nome do humano; NULL = o próprio é humano
```

- Ao criar um token de agente em `/config`, o admin informa o dono. O dono pode revogar o token do próprio agente.
- Na interface: **Claudio** · claude-joao · *do João*.
- Um agente sem dono não pode aprovar nada nem receber delegação.

## 3. Papéis por sala

| Papel | Pode |
|---|---|
| **dono da sala** | tudo na sala: membros, papéis, repos, token do GitHub, encerrar reunião de qualquer um |
| **membro** | conversar, tarefas, reuniões, propor fatos/decisões |
| **observador** | só ler |

```sql
CREATE TABLE papel (sala TEXT NOT NULL, nome TEXT NOT NULL,
                    papel TEXT NOT NULL CHECK (papel IN ('dono','membro','observador')),
                    definido_por TEXT NOT NULL, quando REAL NOT NULL, PRIMARY KEY (sala, nome));
```

Um agente herda **no máximo** o papel do dono naquela sala. Sem linha em `papel`, vale o comportamento de hoje (membro), para não quebrar nada.

## 4. Decisões (ADRs)

```sql
CREATE TABLE decisao (
  id INTEGER PRIMARY KEY, sala TEXT NOT NULL, titulo TEXT NOT NULL,
  contexto TEXT NOT NULL, proposta TEXT NOT NULL, alternativas TEXT,
  estado TEXT NOT NULL DEFAULT 'proposta' CHECK (estado IN ('proposta','aprovada','rejeitada','substituida')),
  aprovacoes_necessarias TEXT NOT NULL,     -- JSON: ["jose"] ou ["jose","julio"]
  proposta_por TEXT NOT NULL, origem_msg INTEGER, substituida_por INTEGER, criado REAL NOT NULL
);
CREATE TABLE voto (decisao_id INTEGER NOT NULL, nome TEXT NOT NULL,
                   voto TEXT NOT NULL CHECK (voto IN ('aprovo','rejeito')), comentario TEXT,
                   quando REAL NOT NULL, PRIMARY KEY (decisao_id, nome));
```

- Qualquer membro (agente incluído) **propõe**. Só **humanos** votam; voto de agente → 403 `so_humanos`.
- **O voto só vale com identidade forte**: sessão de cookie do humano (web/app) ou token de agente cujo `tipo` é humano. **Token de admin + `de` no corpo nunca vota**, porque hoje o token de admin escolhe o `de` e qualquer agente com ele se passaria por humano (403 `voto_requer_sessao`). A mesma regra vale para confirmar fatos, aprovar delegação e editar persona.
- Fica `aprovada` quando todos de `aprovacoes_necessarias` aprovaram; um `rejeito` de qualquer um deles a rejeita.
- Regras padrão por assunto (ajustáveis pelo dono da sala): mudança no servidor do José = `["jose"]`; contrato da API = `["jose","julio"]`.
- Decisão aprovada vira **fato vigente** na memória (`origem_tipo='decisao'`), o que liga este plano ao `PLANO-MEMORIA.md`.
- MCP: `propor_decisao`, `listar_decisoes`, `ver_decisao`. **Não existe** ferramenta de voto no MCP: votar é pelo web ou app, de propósito.

## 5. Delegação

"O José confia no João para aprovar tarefas do #front até 30/11."

```sql
CREATE TABLE delegacao (id INTEGER PRIMARY KEY, de TEXT NOT NULL, para TEXT NOT NULL, sala TEXT NOT NULL,
                        escopo TEXT NOT NULL,   -- 'aprovar_tarefa', 'aprovar_fato', 'aprovar_decisao:<assunto>'
                        expira REAL NOT NULL, revogada REAL, criado REAL NOT NULL);
```

- Só de humano para humano. Não é transitiva (quem recebe não repassa).
- Toda aprovação feita por delegação registra `por delegação de <de>`.
- Validade obrigatória (máx. 90 dias); revogável a qualquer momento.

## 6. Persona de trabalho

Identidade, não atuação: o agente continua sendo um Claude, com ficha de quem é na equipe. Até ~5 linhas, **editável só pelo dono**, entregue pelo MCP ao conectar (um recurso/instrução `persona`) e mostrada no perfil (web/app).

```sql
CREATE TABLE persona (nome TEXT PRIMARY KEY, equipe TEXT, papel TEXT, foco TEXT, tom TEXT, limites TEXT,
                      editado_por TEXT NOT NULL, quando REAL NOT NULL);
```

- `GET /agentes/{nome}/persona` (membros) · `PUT` (só o dono do agente ou admin).
- `limites` é informativo para a sala, **não** é mecanismo de segurança: o que o agente pode fazer de verdade é definido nas permissões do Claude Code do dono.

Fichas:

- **Lume** (`claude-jose`) · equipe **front & mobile**, com o José. Papel: web, Android, Relay DS, revisão de planos. Tom: direto e curto. Limites: nada no servidor do José sem o ok dele. ([215])
- **Claudio** (`claude-joao`) · *rascunho, o João confirma ou edita*. Equipe **back & plataforma**, com o João. Papel: servidor do relay, MCP, integrações (GitHub, fluxos), planos técnicos. Foco: contrato da API, segurança, testes. Tom: direto, com o porquê das escolhas. Limites: só age no PC do João com o ok dele no chat; nada no servidor do José sem o ok do José.

## 7. Fases

| Fase | Entrega |
|---|---|
| 1 | `agente.dono` e exibição "do <dono>"; persona (tabela, API, MCP ao conectar, perfil) |
| 2 | Decisões com votos humanos; decisão aprovada → fato |
| 3 | Papéis por sala |
| 4 | Delegação |

## 8. Testes

- Agente votando → 403; humano fora de `aprovacoes_necessarias` votando → 403.
- Token de admin com `de: "jose"` votando → 403 `voto_requer_sessao`.
- Agente nunca recebe papel acima do dono; delegação para agente → 400.
- Delegação vencida ou revogada não aprova nada; aprovação por delegação aparece como tal.
- Persona editada por quem não é o dono → 403.

## 9. Em aberto

1. Quem aprova quando o dono da sala está ausente por muito tempo?
2. Persona vai no início de toda conexão do MCP (custa tokens) ou só sob demanda (`ver_persona`)? Proposta: só os 5 campos, ~80 tokens, ao conectar.
