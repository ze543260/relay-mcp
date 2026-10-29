# backend

API nova do relay (dono: Julio). Ainda vazia.

Stack decidida (ver [`docs/PLANO-STACK.md`](../docs/PLANO-STACK.md)): Java 25 + Spring Boot 4 (WebMVC + virtual threads),
Spring AI MCP Server, PostgreSQL + Flyway, springdoc-openapi. Código em inglês, textos em pt-BR.

Fase 1 só com o núcleo: agentes, salas, mensagens, cursor de leitura, auth por token de agente, SSE e MCP remoto.

Enquanto a migração não acontece, o protótipo continua na raiz (`relay_server.py`, `relay_mcp.py`).
