# Plano: perfil de participantes (IA e humano)

Status: proposta, aguardando aprovação do José · Autor: Lume (claude-jose) · Ideia: João ([271]), José ([272], [274])
Base: fase 1 do `PLANO-PAPEIS.md` (`agente.dono` + persona).

## 1. Objetivo

Clicar no nome (ou avatar) de qualquer participante abre o **perfil**: quem é, de quem é, o que faz e o que está fazendo. O **dono** vê e controla mais.

## 2. O que aparece

| Seção | Todos veem | Só o dono (e admin) |
|---|---|---|
| Identidade | apelido, nome técnico, tipo (IA/humano), dono ("do João") | renomear apelido |
| Presença | online / visto por último | — |
| **Persona** (ficha) | equipe, papel, foco, tom, limites | **editar** (é a ficha que o MCP entrega ao agente ao conectar) |
| Trabalho | tarefas abertas (responsável), reuniões em que participa | — |
| Memória | fatos que registrou/confirmou | memória privada do agente (quando existir) |
| Acesso | — | token: criado em, último uso, **revogar** / gerar novo |

## 3. Back (Claudio)

- `ALTER TABLE agente ADD COLUMN dono TEXT;` e tabela `persona` (já desenhadas no `PLANO-PAPEIS.md` §2 e §6).
- `GET /agentes/{nome}` → identidade, presença, dono, persona, contagens (tarefas abertas, fatos). Campos de acesso só pro dono/admin.
- `PUT /agentes/{nome}/persona` e `PUT /agentes/{nome}/dono`: só dono ou admin; editar persona exige identidade forte (não admin+`de`).
- Evento SSE `perfil` (nome) pra atualizar quem estiver com o painel aberto.
- MCP: ao conectar, entrega a persona do próprio agente (~80 tokens); `ver_perfil(nome)` enxuto.

## 4. Front (Lume)

- **Web**: `Sheet` lateral (tela cheia no celular), aberto pelo nome/avatar na conversa, nos participantes do topo, no quadro (responsável) e na memória (autor). Persona com edição inline (5 campos, contador de caracteres), tarefas/fatos como listas curtas com link pro quadro/memória.
- **App**: tela de perfil equivalente (bottom sheet), com edição da persona para o dono.
- Avatar segue a regra atual (IA = círculo, humano = quadrado arredondado), com selo "do <dono>".

## 5. Fases

| Fase | Entrega | Quem |
|---|---|---|
| 0 | Aprovação do José | José |
| 1 | `dono`, `persona`, `GET /agentes/{nome}`, edição com identidade forte | Claudio, revisão do Lume |
| 2 | Painel de perfil no web + edição da persona | Lume |
| 3 | Seção de acesso (token) pro dono; tela no app | Lume |

## 6. Em aberto

1. Humanos também têm persona (ex.: "José · front & mobile")? Proposta: sim, opcional.
2. "Visto por último" é visível pra todos ou só pra quem já é da sala? Proposta: todos da sala.
