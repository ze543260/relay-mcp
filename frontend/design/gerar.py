#!/usr/bin/env python3
"""Gera os tokens do Relay DS para cada plataforma a partir de design/tokens.json.

Saídas (não editar à mão):
- web/src/styles/tokens.css                                  (CSS custom properties, claro/escuro/data-theme)
- web/src/styles/tokens.ts                                   (valores usados em JS: paleta dos agentes, movimento)
- android/app/src/main/java/dev/josev/relay/ui/tema/Tokens.kt (objetos Kotlin com Color/Dp/Sp)
"""
import json
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
T = json.loads((RAIZ / "design" / "tokens.json").read_text())
AVISO = f"Gerado por design/gerar.py a partir de design/tokens.json (Relay DS {T['versao']}). Não edite à mão."


def camel(nome: str) -> str:
    partes = re.split(r"[-_]", nome)
    return partes[0] + "".join(p.capitalize() for p in partes[1:])


def css() -> str:
    def bloco(tema: dict, recuo: str) -> str:
        return "\n".join(f"{recuo}--{k}: {v};" for k, v in tema.items())

    claro, escuro = T["cor"]["claro"], T["cor"]["escuro"]
    linhas = [f"/* {AVISO} */", "", ":root {", bloco(claro, "  ")]
    linhas += [f"  --raio-{k}: {v}px;" for k, v in T["raio"].items()]
    linhas += [f"  --espaco-{k}: {v}px;" for k, v in T["espaco"].items()]
    linhas += [f"  --agente-{i}: {c};" for i, c in enumerate(T["cor"]["agentes"])]
    linhas += [f"  --alvo-toque: {T['alvo-toque']}px;"]
    linhas += [f"  --mov-{k}: {v}{'ms' if isinstance(v, int) else ''};" for k, v in T["movimento"].items()]
    for k, e in T["tipo"]["escala"].items():
        linhas.append(f"  --tipo-{k}: {e['peso']} {e['tamanho']}px/{e['altura']}px;")
    linhas += ["  color-scheme: light dark;", "}", ""]
    linhas += ["@media (prefers-color-scheme: dark) {", '  :root:not([data-theme="light"]) {', bloco(escuro, "    "), "  }", "}", ""]
    # Também em qualquer elemento com data-theme (guia vivo /ds, prévias aninhadas).
    linhas += ['[data-theme="dark"] {', bloco(escuro, "  "), "  color-scheme: dark;", "}", ""]
    linhas += ['[data-theme="light"] {', bloco(claro, "  "), "  color-scheme: light;", "}", ""]
    return "\n".join(linhas)


def kotlin() -> str:
    def cor(h: str) -> str:
        return f"Color(0xFF{h.lstrip('#').upper()})"

    def objeto_cores(nome: str, tema: dict) -> list[str]:
        out = [f"    object {nome} {{"]
        out += [f"        val {camel(k)} = {cor(v)}" for k, v in tema.items()]
        out.append("    }")
        return out

    l = [f"// {AVISO}", "package dev.josev.relay.ui.tema", "",
         "import androidx.compose.ui.graphics.Color", "import androidx.compose.ui.unit.dp", "import androidx.compose.ui.unit.sp", "",
         "object Tokens {"]
    l += objeto_cores("Claro", T["cor"]["claro"])
    l += objeto_cores("Escuro", T["cor"]["escuro"])
    l.append(f"    val agentes = listOf({', '.join(cor(c) for c in T['cor']['agentes'])})")
    l.append("    object Raio {")
    l += [f"        val {camel(k) if not k[0].isdigit() else 'r' + k} = {v}.dp" for k, v in T["raio"].items()]
    l.append("    }")
    l.append("    object Espaco {")
    l += [f"        val e{k} = {v}.dp" for k, v in T["espaco"].items()]
    l.append("    }")
    l.append("    object Tipo {")
    for k, e in T["tipo"]["escala"].items():
        n = camel(k)
        l.append(f"        val {n}Tamanho = {e['tamanho']}.sp")
        l.append(f"        val {n}Altura = {e['altura']}.sp")
        l.append(f"        const val {n}Peso = {e['peso']}")
    l.append("    }")
    l.append(f"    val alvoToque = {T['alvo-toque']}.dp")
    l.append(f"    const val movRapido = {T['movimento']['rapido']}")
    l.append(f"    const val movPadrao = {T['movimento']['padrao']}")
    l.append(f"    const val movEntrada = {T['movimento']['entrada']}")
    l.append("}")
    return "\n".join(l) + "\n"


def ts() -> str:
    return "\n".join([
        f"// {AVISO}",
        f"export const CORES_AGENTES = {json.dumps(T['cor']['agentes'])} as const;",
        f"export const ALVO_TOQUE = {T['alvo-toque']};",
        f"export const MOVIMENTO = {json.dumps(T['movimento'])} as const;",
        "",
    ])


def main() -> None:
    destino_css = RAIZ / "web" / "src" / "styles" / "tokens.css"
    destino_kt = RAIZ / "android" / "app" / "src" / "main" / "java" / "dev" / "josev" / "relay" / "ui" / "tema" / "Tokens.kt"
    destino_css.parent.mkdir(parents=True, exist_ok=True)
    destino_css.write_text(css())
    (destino_css.parent / "tokens.ts").write_text(ts())
    destino_kt.write_text(kotlin())
    print(f"ok: {destino_css.relative_to(RAIZ)}, {destino_kt.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
