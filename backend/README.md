# backend

API nova do relay (dono: Julio). Substitui o protótipo `relay_server.py` da raiz, que continua no ar até a migração.

Stack (ver [`docs/PLANO-STACK.md`](../docs/PLANO-STACK.md)): Java 25, Spring Boot 4.1 (WebMVC + virtual threads),
Spring Security, Spring Data JPA, PostgreSQL 17 + Flyway, Spring AI MCP Server (Streamable HTTP em `/mcp`),
springdoc-openapi (`/openapi.json`), Testcontainers.

Convenções: código em inglês, comentários e mensagens ao usuário em pt-BR. Pacotes por feature
(`dev.relay.api.<feature>`), cada uma com `domain` → `application` → `web`; o que é transversal fica em `shared`.

## Rodando localmente

Pré-requisitos: JDK 25 e Docker.

```bash
./mvnw spring-boot:run   # sobe o Postgres do compose.yaml sozinho; API em http://localhost:8080
```

- Probes: `/livez` e `/readyz` (abertos); health completo na porta de gerência `8081`.
- Contrato: `/openapi.json`.
- MCP remoto: `/mcp` (exige autenticação, que chega com os tokens por agente).

## Testes

```bash
./mvnw verify
```

Sobe um Postgres real via Testcontainers (o Docker precisa estar ativo) e falha se a cobertura de linhas das
camadas `domain` e `application` ficar abaixo de 80%.

## Fase 1 (só o núcleo)

Agentes, salas, mensagens, cursor de leitura, auth por token de agente (+ cookie de sessão pro dashboard),
SSE e MCP remoto. O `relay_server.py` é o oráculo do contrato: os testes de `tests/` podem rodar contra esta API.
