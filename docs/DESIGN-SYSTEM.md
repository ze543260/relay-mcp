# Relay DS

Design system próprio do Relay, compartilhado entre o dashboard web e o app Android.

- **Fonte única:** [`design/tokens.json`](../design/tokens.json): cores (claro/escuro), paleta dos agentes, raios, espaços, tipografia, alvo de toque, movimento e regras de uso.
- **Gerador:** `python3 design/gerar.py` escreve:
  - `web/src/styles/tokens.css`: custom properties (`:root`, `prefers-color-scheme`, `[data-theme]`);
  - `web/src/styles/tokens.ts`: valores usados em JS (paleta dos agentes, movimento);
  - `android/.../ui/tema/Tokens.kt`: `Color`, `Dp` e `Sp` para o `TemaRelay`.
  Arquivos gerados não se editam à mão.
- **Guia vivo:** `/ds` no dashboard mostra os tokens e os **componentes de produção** (não cópias) nos dois temas.

## Camadas

| Camada | Web | Android |
|---|---|---|
| Tokens | `tokens.css` → shadcn (`--primary: var(--acento)` …) | `Tokens.kt` → `MaterialTheme` (`primary = acento` …) |
| Primitivos | shadcn/Base UI (Button, Input, Badge, Sidebar, Dialog…) | Material 3 |
| Componentes Relay | `Mensagem`, `Composer`, `Conversa`, `BarraLateral`, `Participantes` | `Bolha`, `Composer`, `Gaveta`, `Participantes` |

## Regras (resumo do `tokens.json`)

- **Acento** só para ação primária, estado ativo, não lidas e menções. Nunca para texto corrido.
- **Avatar:** IA = círculo, humano = quadrado com raio de 25%. A cor sai do hash do nome na paleta `agentes`, com o mesmo algoritmo nas duas plataformas.
- **Bolha:** canto superior esquerdo com raio `bolha-canto` (4) e os outros com `bolha` (12).
  - Minha: borda acento 35%.
  - Menção a mim: borda acento 60% + fundo acento 8%.
  - Falhou: borda erro 60%.
  - Enviando: opacidade 60%.
- **Leitura:** a mensagem só conta como lida no fim da lista com a tela visível. O divisor "Novas mensagens" fica em acento.
- **Toque:** alvo mínimo de 44 px/dp. No toque, Enter quebra linha e o envio é pelo botão.
- **Movimento:** 150 ms (rápido) / 220 ms (padrão) / 300 ms (entrada), curva `cubic-bezier(0.2, 0, 0, 1)`. Sempre respeitando `prefers-reduced-motion`.

## Mudando um token

1. Edite `design/tokens.json`.
2. `python3 design/gerar.py`
3. Web: `cd web && npm run build`. Android: `cd android && ./gradlew assembleRelease`.
4. Confira em `/ds`.
