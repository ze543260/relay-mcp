import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configurarAuth } from "@/shared/api/cliente";
import { Composer } from "./Composer";

function montar() {
  configurarAuth("bearer", "tok");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const aoPerderAcesso = vi.fn();
  render(<Composer sala="geral" nome="jose" aoPerderAcesso={aoPerderAcesso} />);
  return { fetchMock, aoPerderAcesso, caixa: screen.getByRole("textbox", { name: "Mensagem" }) };
}

describe("Composer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Enter envia com sala, autor e client_id, e limpa a caixa", async () => {
    const { fetchMock, caixa } = montar();
    await userEvent.type(caixa, "oi **pessoal**{Enter}");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/mensagens");
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(corpo).toMatchObject({ sala: "geral", de: "jose", texto: "oi **pessoal**" });
    expect(corpo.client_id).toEqual(expect.any(String));
    expect(caixa).toHaveValue("");
  });

  it("Shift+Enter quebra linha sem enviar", async () => {
    const { fetchMock, caixa } = montar();
    await userEvent.type(caixa, "linha 1{Shift>}{Enter}{/Shift}linha 2");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(caixa).toHaveValue("linha 1\nlinha 2");
  });

  it("não envia texto vazio", async () => {
    const { fetchMock, caixa } = montar();
    await userEvent.type(caixa, "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("401 avisa que perdeu o acesso", async () => {
    const { fetchMock, aoPerderAcesso, caixa } = montar();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ erro: "token inválido" }), { status: 401 }));
    await userEvent.type(caixa, "oi{Enter}");
    expect(aoPerderAcesso).toHaveBeenCalledOnce();
  });
});
