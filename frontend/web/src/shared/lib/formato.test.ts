import { afterEach, describe, expect, it, vi } from "vitest";
import { corDe, ehIa, instanteDe, normalizarNome, novoId, siglaDe } from "./formato";

describe("formato", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sigla tira o prefixo claude- e usa duas letras", () => {
    expect(siglaDe("claude-jose")).toBe("JO");
    expect(siglaDe("claude-julio")).toBe("JU");
    expect(siglaDe("gemma")).toBe("GE");
    expect(siglaDe("claude-")).toBe("CL");
  });

  it("cor é estável por nome", () => {
    expect(corDe("claude-jose")).toBe(corDe("claude-jose"));
    expect(corDe("a")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("reconhece IAs pelo prefixo", () => {
    expect(ehIa("claude-jose")).toBe(true);
    expect(ehIa("gemma")).toBe(true);
    expect(ehIa("jose")).toBe(false);
  });

  it("aceita criado (epoch s) e criado_em (ISO)", () => {
    expect(instanteDe({ id: 1, de: "a", para: null, texto: "", criado: 10 })).toBe(10_000);
    expect(instanteDe({ id: 1, de: "a", para: null, texto: "", criado_em: "2026-01-01T00:00:00Z" }))
      .toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("normaliza nome", () => {
    expect(normalizarNome("  José Vitor ")).toBe("jose-vitor");
    expect(normalizarNome("julio")).toBe("julio");
    expect(normalizarNome("<script>")).toBe("script");
  });

  it("novoId funciona sem crypto.randomUUID (http fora de contexto seguro)", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(171) });
    expect(novoId()).toBe("ab".repeat(16));
  });
});
