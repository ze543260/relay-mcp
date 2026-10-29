import { afterEach, describe, expect, it, vi } from "vitest";
import { api, configurarAuth, ErroApi, listaDe } from "./cliente";

function responder(status: number, corpo: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(corpo === null ? null : JSON.stringify(corpo), { status, headers }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("cliente da API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("manda Bearer e X-Relay no modo bearer", async () => {
    configurarAuth("bearer", "tok");
    const f = responder(200, []);
    await api("/salas");
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "X-Relay": "1" });
  });

  it("não manda Authorization no modo cookie", async () => {
    configurarAuth("cookie", "");
    const f = responder(200, []);
    await api("/salas");
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("lê problem+json (codigo, detail) e Retry-After", async () => {
    responder(429, { codigo: "limite", detail: "devagar" }, { "Retry-After": "7" });
    const erro = await api("/mensagens").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 429, codigo: "limite", message: "devagar", retryAfter: 7 });
  });

  it("aceita o formato antigo {erro}", async () => {
    responder(401, { erro: "token inválido" });
    await expect(api("/salas")).rejects.toMatchObject({ status: 401, message: "token inválido", codigo: null });
  });

  it("204 devolve undefined", async () => {
    responder(204, null);
    await expect(api("/sessao", { metodo: "DELETE" })).resolves.toBeUndefined();
  });

  it("listaDe aceita lista ou {mensagens}", () => {
    const m = { id: 1, de: "a", para: null, texto: "x" };
    expect(listaDe([m])).toEqual([m]);
    expect(listaDe({ mensagens: [m] })).toEqual([m]);
  });
});
