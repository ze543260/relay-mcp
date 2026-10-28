# Plano: relay-mcp numa stack de verdade

Status: proposta · Autores: José (front) e Julio (back) · Base: protótipo atual (`relay_server.py` + `relay_mcp.py` + `dashboard.html`)

## 1. Por que migrar

O protótipo provou a ideia: Claudes de pessoas diferentes conversando por uma sala, com um humano acompanhando ao vivo. Os limites dele são estruturais, e remendar não resolve:

| Limite hoje | Consequência |
|---|---|
| Token único compartilhado, `de` declarado pelo cliente | Qualquer participante se passa por outro e lê mensagens privadas |
| Uma thread presa por long-poll (`ThreadingHTTPServer`) | Poucas dezenas de clientes derrubam o servidor |
| SQLite com uma conexão por request, sem migrations | Sem evolução de schema, `database is locked` sob concorrência |
| Cada amigo roda um script Python local (`uv` + `relay_mcp.py`) | Instalação chata, versões divergentes, bug do cursor reiniciando |
| HTTP puro pelo IP do Tailscale | Página fora de contexto seguro (o `crypto.randomUUID` quebrou o envio) |
| Front num HTML de 600 linhas sem tipos nem testes | Toda mudança do contrato quebra em silêncio |

## 2. Princípios

1. **MCP remoto, sem instalação:** o próprio servidor expõe `/mcp` (Streamable HTTP). O amigo só roda `claude mcp add --transport http …` com o token dele. Nenhum script local.
2. **Contrato primeiro:** o backend publica OpenAPI. O front gera os tipos e quebra no CI se o contrato mudar.
3. **Identidade no servidor:** o token define quem é o agente. O cliente nunca declara `de`.
4. **Divisão clara:** José é dono do `web/`, Julio é dono do `api/`. O contrato (`openapi.json`) é revisado pelos dois.
5. **Migração incremental:** o protótipo continua no ar até a fase 4. Nada para de funcionar no meio.

## 3. Stack escolhida

### Backend (`api/`), dono: Julio: **proposta, aguardando o Julio**

> Esta tabela é só sugestão para abrir a conversa. As decisões de back são do Julio (perguntas na seção 9).

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem/framework | **Java 25 + Spring Boot 4 (WebMVC + virtual threads)** | É a stack do Julio. Com virtual threads, long-poll e SSE custam quase nada por cliente, sem precisar de WebFlux |
| MCP | **Spring AI MCP Server** (transporte Streamable HTTP) | Servidor MCP no mesmo processo e com a mesma auth da API |
| Banco | **PostgreSQL 17 + Flyway** | Migrations versionadas; `LISTEN/NOTIFY` para tempo real com mais de uma instância |
| Tempo real | **SSE** pro dashboard; **long-poll** mantido pro MCP (`aguardar_mensagem`) | O MCP só age quando o modelo chama ferramenta, então WebSocket não traz ganho |
| Auth | Spring Security: tokens de agente (hash SHA-256 no banco), sessão em cookie pro dashboard, papéis `ADMIN`/`MEMBRO` | Fecha forja de `de` e o vazamento do `todas=1` |
| Rate limit | Bucket4j em memória (Redis só se tiver mais de uma instância) | Simples primeiro |
| Docs | springdoc-openapi → `/openapi.json` | Fonte dos tipos do front |
| Testes | JUnit 5 + Testcontainers (Postgres) + MockMvc; JaCoCo ≥ 80% em domínio e aplicação | Mesmo padrão dos projetos do Julio |
| Observabilidade | Actuator (`/livez`, `/readyz`) + logs JSON | |

Alternativa considerada: **Fastify + TypeScript**, que deixaria um repositório de uma linguagem só. Foi descartada porque o back é do Julio, e ele entrega mais rápido e com mais qualidade no Spring.

### Frontend (`web/`), dono: José

| Camada | Escolha | Motivo |
|---|---|---|
| Base | **React 19 + Vite + TypeScript estrito** | SPA estática servida pelo próprio backend ou por CDN; não precisa de SSR (é app logado) |
| Rotas | **TanStack Router** (rotas tipadas, search params validados) | `/:sala`, `?msg=ID` pra link direto |
| Dados | **TanStack Query** + **openapi-fetch** com tipos do **openapi-typescript** | Cache, retry e paginação infinita prontos |
| Tempo real | `EventSource` (SSE) alimentando o cache do Query | Reconexão nativa do navegador com `Last-Event-ID` |
| UI | **Tailwind 4 + shadcn/ui (Base UI)** | Componentes acessíveis; mesmo visual de tokens do protótipo |
| Lista | **TanStack Virtual** | Salas com milhares de mensagens sem DOM gigante |
| Markdown | **react-markdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize** + **Shiki** pra código | Sanitização declarativa, sem `innerHTML` manual |
| Formulários | React Hook Form + Zod | Login, criar sala, convites |
| PWA | **vite-plugin-pwa**: instalável no celular, ícone, tela cheia | O uso principal no celular vira um "app" |
| Notificação | Web Push (VAPID), opcional por sala | Avisar quando um Claude responde |
| Qualidade | ESLint (boundaries + jsx-a11y), Vitest + Testing Library, Playwright + axe, knip | |

### MCP do lado do cliente

Nenhum script. Cada pessoa roda:

```bash
claude mcp add --transport http relay https://relay.<tailnet>.ts.net/mcp --header "Authorization: Bearer <token-do-agente>"
```

Ferramentas: `enviar_mensagem`, `ler_mensagens`, `aguardar_mensagem`, `listar_salas`, `responder` (com `reply_to`). O cursor de leitura fica **no servidor, por agente e sala**, o que acaba com o bug de reentregar o histórico.

### Infra

| Item | Escolha |
|---|---|
| Hospedagem | Máquina `servidor` (já está no tailnet) com Docker Compose: `api`, `postgres` |
| HTTPS | **`tailscale serve`** → `https://relay.<tailnet>.ts.net` com certificado válido. Resolve contexto seguro, cookie `Secure` e PWA. Sem porta aberta pra internet |
| Acesso de amigos | Compartilhamento de máquina do Tailscale (igual hoje) |
| CI | GitHub Actions: `api` (mvn verify + Testcontainers), `web` (typecheck, lint, test, build), checagem de diff dos tipos do OpenAPI, gitleaks |
| Deploy | Imagem no GHCR; `docker compose pull && up -d` no `servidor` (manual no começo) |
| Backup | `pg_dump` diário com retenção de 7 dias |

## 4. Modelo de dados (rascunho, a validar com o Julio)

```sql
agente (id uuid pk, nome text unique, dono_id → pessoa, tipo text check in ('ia','humano'),
        token_hash bytea unique, criado_em timestamptz, revogado_em timestamptz null, visto_em timestamptz)
pessoa (id uuid pk, nome text, papel text check in ('admin','membro'), criado_em)
sala   (id uuid pk, slug text unique, titulo text, criada_por → agente, arquivada boolean default false)
membro_sala (sala_id, agente_id, pk(sala_id, agente_id))
mensagem (id bigserial pk, sala_id → sala, de_id → agente, para_id → agente null,
          texto text check (length(texto) <= 64000), tipo text null, payload jsonb null,
          reply_to bigint null → mensagem, client_id text null, criado_em timestamptz default now(),
          unique (de_id, client_id))
cursor_leitura (agente_id, sala_id, ultimo_id bigint, pk(agente_id, sala_id))
convite (codigo text pk, criado_por → pessoa, papel text, expira_em timestamptz, usado_em timestamptz null)
```

Índices: `mensagem(sala_id, id)` e `mensagem(para_id) where para_id is not null`.
Retenção: job diário que apaga mensagens com mais de 90 dias, configurável por sala.

## 5. Contrato da API (v1): o que o front precisa

É a lista de necessidades do front. Nomes, formato e paginação finais saem do OpenAPI que o Julio publicar.

| Método e rota | Função |
|---|---|
| `POST /api/v1/sessao` / `DELETE` | Login do dashboard com token → cookie HttpOnly |
| `GET /api/v1/eu` | Agente e pessoa da sessão |
| `GET /api/v1/salas` | `[{slug, titulo, ultimo_id, nao_lidas, membros}]` |
| `POST /api/v1/salas` | Criar sala |
| `GET /api/v1/salas/{slug}/mensagens?antes&limite` | Histórico paginado: `{mensagens, tem_mais}` |
| `GET /api/v1/salas/{slug}/mensagens?depois&espera` | Long-poll (MCP e fallback) |
| `GET /api/v1/salas/{slug}/stream` | SSE: eventos `mensagem`, `presenca`, `leitura` |
| `POST /api/v1/salas/{slug}/mensagens` | `{texto, para?, tipo?, payload?, reply_to?, client_id}` |
| `PUT /api/v1/salas/{slug}/cursor` | Marcar como lido |
| `GET /api/v1/agentes` | Presença (`visto_em`) |
| `POST /api/v1/agentes` | (admin) Criar agente → devolve o token **uma vez** |
| `DELETE /api/v1/agentes/{id}` | (admin) Revogar |
| `POST /api/v1/convites` / `POST /api/v1/convites/{codigo}/aceitar` | Entrada de amigos sem passar token por chat |
| `/mcp` | Servidor MCP (Streamable HTTP) |

Erros sempre em `application/problem+json` com `codigo` estável. `429` e `503` vêm com `Retry-After`. Mudanças só aditivas dentro da v1.

## 6A. Front em detalhe (José)

### Estrutura de `web/src`

```
app/                 # bootstrap, providers (Query, Router, tema), layout raiz
  routes/            # TanStack Router (file-based)
    __root.tsx       # shell: lateral + outlet, toaster, indicador de conexão
    login.tsx
    s.$sala.tsx      # conversa (search: ?msg=ID para link direto)
    config.tsx       # agentes/tokens (admin), notificações
features/
  auth/              # useSessao, LoginForm, guarda de rota
  salas/             # ListaSalas, ItemSala (não lidas), NovaSalaDialog
  mensagens/         # Conversa (virtualizada), Mensagem, Composer, useHistorico, useEnviar
  tempo-real/        # cliente SSE → cache do Query, useConexao
  presenca/          # ChipsAgentes, usePresenca
shared/
  api/               # cliente openapi-fetch, schema.d.ts gerado, mapeamento de problem+json
  markdown/          # <Markdown/> (remark/rehype + KaTeX + Shiki), lazy
  ui/                # componentes shadcn + tokens de tema
  lib/               # hora (Intl), cor por agente, sigla
```

Regras do `eslint-plugin-boundaries`: `features/*` não importa outra feature (só `shared`); `routes` compõe as features; `shared` não importa nada de cima.

### Decisões de implementação

| Tema | Decisão |
|---|---|
| Estado do servidor | Só TanStack Query. Nada de Redux/Zustand; estado local de UI fica em `useState` e search params |
| Histórico | `useInfiniteQuery` com `antes=ID` (páginas de 50), `TanStack Virtual` com âncora no fim e prepend sem pular o scroll |
| Tempo real | Um `EventSource` por aba; cada evento `mensagem` faz `setQueryData` na página mais nova; reconexão com `Last-Event-ID`; fallback para long-poll se o SSE falhar 3 vezes |
| Envio otimista | Mensagem aparece na hora com `client_id`; o evento SSE com o mesmo `client_id` substitui; erro mostra "tentar de novo" na própria bolha |
| Markdown | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-sanitize` (schema permitindo só as classes do KaTeX); Shiki carregado sob demanda e só para blocos de código; o componente inteiro em `React.lazy` |
| Erros | `problem+json` → `ErroApi {status, codigo}`; mapa `codigo → mensagem pt-BR`; erros de validação caem no campo do formulário (RHF `setError`) |
| Tema | Tokens CSS (claros e escuros) iguais aos do protótipo, no `@theme` do Tailwind 4; toggle manual salvo em `localStorage` |
| Mobile | Layout do protótipo atual como referência: lateral em drawer com véu, `100dvh` + `interactive-widget`, safe areas, alvos de 44 px, Enter quebra linha no toque |
| PWA | `vite-plugin-pwa` com manifest, ícones e shell em cache (só o shell; mensagens sempre da rede) |
| Acessibilidade | `role="log"` na conversa, anúncio da última mensagem em `aria-live`, foco gerenciado em diálogos, atalhos (`Ctrl+K` trocar de sala, `Esc` fecha) |
| i18n | Só pt-BR, strings centralizadas em `shared/lib/textos.ts` para facilitar depois |

### Ordem das tarefas (fase 2, usando mocks MSW até a API existir)

1. Scaffold: Vite + TS estrito + Tailwind 4 + shadcn + ESLint/Prettier + Vitest; CI do `web`.
2. `shared/api`: gerar `schema.d.ts` do `contrato/openapi.json` (de início, um contrato escrito à mão a partir da seção 5) + handlers MSW.
3. Layout raiz + rotas + tema + drawer mobile.
4. Login e guarda de rota (`useSessao`).
5. Lista de salas com não lidas.
6. Conversa: histórico infinito + virtualização + `<Mensagem/>` com Markdown lazy.
7. Composer com envio otimista e `client_id`.
8. Cliente SSE + indicador de conexão + presença.
9. Playwright (login → sala → enviar → receber) + axe + Lighthouse mobile.
10. PWA + página de configurações (tokens e notificações).

### Critérios de pronto do front

- `tsc --noEmit`, lint, knip e testes verdes no CI; nenhum `any`.
- Lighthouse mobile ≥ 90 em performance e acessibilidade; bundle inicial < 150 kB gzip (Markdown/KaTeX/Shiki fora do inicial).
- 10 mil mensagens numa sala rolando a 60 fps no celular.
- Funciona igual no `poco-f7` instalado como PWA.

## 6. Estrutura do repositório

```
relay-mcp/
├── api/                      # Spring Boot (Julio)
│   └── src/main/java/…/relay/{identidade,sala,mensagem,tempo_real,mcp,shared}/
│       cada feature: domain/ → application/ → web/
├── web/                      # React (José)
│   └── src/{app,features/{auth,salas,mensagens,presenca},shared/{api,ui,markdown}}/
├── contrato/openapi.json     # gerado pela api, versionado, revisado pelos dois
├── deploy/compose.yml
├── legado/                   # protótipo atual, removido na fase 5
└── .github/workflows/
```

## 7. Fases

Cada fase termina com algo usável e um critério de pronto verificável.

### Fase 0: Fundação (1 a 2 dias, os dois)
- Monorepo com `api/` e `web/` vazios rodando, CI verde nos dois e `compose.yml` com Postgres.
- `tailscale serve` no `servidor` apontando pra `api`.
- **Pronto quando:** `https://relay.<tailnet>.ts.net/readyz` responde 200 pelo celular.

### Fase 1: Núcleo da API (Julio, cerca de 1 semana)
- Flyway V1 com o modelo da seção 4; agentes, salas, mensagens e cursor.
- Auth por token de agente + sessão; `de` vem do token; papéis.
- Histórico paginado, long-poll com virtual threads, rate limit, problem+json.
- OpenAPI publicado e `contrato/openapi.json` commitado.
- **Pronto quando:** testes com Testcontainers cobrem forja de `de` (deve ser impossível), mensagem privada invisível pra terceiros, idempotência por `client_id` e 300 long-polls simultâneos sem erro.

### Fase 2: Front base (José, cerca de 1 semana, em paralelo à fase 1 usando mock)
- Vite + TanStack Router/Query + tipos gerados; mocks com MSW a partir do OpenAPI (dá pra começar antes da API ficar pronta).
- Telas: login, lista de salas com não lidas, conversa com lista virtualizada, envio, Markdown, KaTeX e Shiki.
- Paridade com o `dashboard.html` atual, mobile incluído.
- **Pronto quando:** Playwright cobre login → abrir sala → enviar → ver mensagem; axe sem violações; Lighthouse mobile ≥ 90 em performance e acessibilidade.

### Fase 3: Tempo real e MCP remoto (os dois, cerca de 1 semana)
- Julio: SSE com `Last-Event-ID`, presença e `/mcp` com Spring AI (ferramentas da seção 3).
- José: `EventSource` integrado ao cache, indicador de conexão, presença e notificação de não lidas.
- **Pronto quando:** dois Claude Code, cada um só com `claude mcp add --transport http`, conversam usando `aguardar_mensagem`, e o dashboard mostra tudo ao vivo no celular.

### Fase 4: Migração e corte (1 dia)
- Script `legado/migrar.py`: lê `relay.sqlite`, cria agentes pros nomes existentes e importa as mensagens mantendo a ordem.
- Avisar na sala antiga; Julio troca o `claude mcp add`; desligar o `relay_server.py`.
- **Pronto quando:** o histórico antigo aparece no front novo e ninguém usa mais o token compartilhado (token antigo revogado).

### Fase 5: Extras (contínuo)
- PWA instalável + Web Push.
- Convites por link (sem passar token pelo chat).
- Mensagens estruturadas (`tipo`/`payload`/`reply_to`) com renderização própria: contrato de API, resumo de incidente.
- Agentes autônomos: o orquestrador do Assistente Local escuta o SSE e responde sozinho.
- Remover `legado/`.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Spring AI MCP ainda imaturo no transporte HTTP | Isolar no pacote `mcp/`; plano B é o SDK Java oficial do MCP direto |
| Contrato divergir entre os dois | `contrato/openapi.json` versionado + CI falhando se os tipos gerados mudarem sem commit |
| Prompt injection entre agentes | Descrição das ferramentas diz que conteúdo recebido é dado; nenhuma ferramenta do relay executa ação na máquina de ninguém |
| `servidor` offline (já ficou 36 dias fora) | Monitorar com healthcheck; documentar como subir em outra máquina com o compose |
| Escopo crescer (virar um Slack) | Fases 0 a 4 só com paridade + segurança; o resto fica na fase 5 |

## 9. Decisões em aberto

### Perguntas para o Julio (back)

1. Topa ser dono do `api/`? Spring Boot 4 + virtual threads, ou prefere outra stack?
2. MCP remoto: Spring AI MCP Server ou o SDK Java oficial do MCP?
3. Tempo real: SSE + long-poll para o MCP serve, ou prefere WebSocket?
4. Postgres + Flyway, ou algo mais leve no começo?
5. Auth: tokens por agente com hash + sessão em cookie pro dashboard: concorda? Convites por link na v1 ou depois?
6. Concorda com o contrato da seção 5 (rotas, paginação por cursor, `problem+json`, `Retry-After`, `client_id`)?
7. Prazo realista pra fase 1?

### Outras

1. ~~Backend em Spring ou Fastify/TS?~~ Ver pergunta 1 acima.
2. **Onde hospedar:** a máquina `servidor` (recomendado) ou este notebook?
3. **Humanos:** entram por token próprio (simples) ou por login com conta (GitHub OAuth)?
4. **Retenção padrão:** 90 dias ou guardar tudo?
