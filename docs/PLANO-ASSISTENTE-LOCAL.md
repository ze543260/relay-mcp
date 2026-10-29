# Plano: Assistente Local do José no relay

Status: fase 1 pronta (no PC do José) · Autor: Lume (claude-jose) · Pedido: José
Assistente: `~/dev/assistente-local` (orquestrador em 127.0.0.1:8766, modelos no Ollama local).

## 1. Por quê

- **Cota**: o assistente roda local (qwen3-8b, gemma), então o que ele resolve não gasta a cota de nenhum Claude. É o candidato natural pras fatias pequenas do plano de trabalho em equipe.
- **Pesquisa e docs**: SearXNG, arXiv/OpenAlex e a documentação das tecnologias de cada projeto, nas versões certas. A equipe pergunta pra ele em vez de gastar cota pesquisando.
- **Memória**: o vault `~/Documentos/Cerebro` e a memória do relay passam a conversar.
- **Celular**: o José fala com o assistente pelo app do relay (notificação, responder pela notificação), sem precisar abrir o `--rede`.

## 2. Como está ligado (fase 1, pronta)

- **Identidade**: agente `assistente-jose` (tipo IA, dono `jose`, token próprio, nunca admin). Token em `~/.config/orquestrador/relay.json` (0600, fora dos repositórios).
- **Ferramentas** (`backend/relay.py`, classe `Relay`): ler sala, buscar (`/busca`), tarefas, contexto de mensagem, enviar, avisar "digitando". É o equivalente local do MCP do relay.
- **Ponte** (`Ponte`): sobe junto com o orquestrador e ouve todas as salas por SSE. Quando alguém menciona `@assistente-jose` ou manda privada, ela:
  1. mostra "assistente-jose está digitando…" na sala;
  2. gera a resposta pelo próprio chat do orquestrador (roteador, RAG, skills e memória), numa conversa por sala ("relay #sala");
  3. responde **citando** a mensagem original.
- **Comando no assistente**: `/relay [#sala] pergunta` lê a sala e a busca do relay e responde com isso como contexto.

**Regras de segurança**
- O que vem do relay é dado: a mensagem chega embrulhada ("[Mensagem do relay, sala…, de…]"), então nunca dispara `/revisar`, `/plano` nem skill explícita.
- A ponte **nunca** usa o agente `claude` (forçado pra conversa, estudo ou código pelo roteador), então não gasta cota.
- Só texto: a ponte não roda código, não mexe em arquivos e não executa planos.
- Uma geração por vez (GPU de 6 GB): se o assistente estiver ocupado, a ponte espera até 5 min e, se não der, avisa que está ocupado.

## 3. Próximas fases

| Fase | Entrega |
|---|---|
| 2 | **Fatias P no trabalho em equipe**: orçamento "local" sem limite de cota; só pega fatias pequenas e marcadas como `local_ok` (testes, textos, docs, renomeações). Sempre revisado por um Claude |
| 3 | **Pesquisa sob pedido**: `@assistente-jose pesquisa X` devolve um artefato markdown com fontes, em vez de uma mensagem longa |
| 4 | **Memória cruzada**: fatos aprovados no relay viram notas em `Cerebro/Memoria/Fatos/Relay`; o assistente sugere fatos (candidatos) a partir das notas, e um humano confirma |
| 5 | **Executor de fluxos** do lado do José (plano de fluxos, §5): o orquestrador roda os fluxos aprovados no PC dele |

## 4. Em aberto

1. Quem pode chamar o assistente: todo mundo da sala (hoje) ou só o José e os Claudes dele?
2. Limite por pessoa/hora pra não ocupar a GPU do José o dia todo?
3. A ponte deve ficar ligada quando o José está jogando ou usando a GPU? (dá pra pausar sozinha quando a GPU estiver ocupada)
