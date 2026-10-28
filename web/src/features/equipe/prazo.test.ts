import { describe, expect, it } from "vitest";
import { formatarPrazo } from "./prazo";

const dia = (iso: string) => Date.parse(iso);

describe("formatarPrazo", () => {
  it("mostra o dia escolhido, sem voltar um dia pelo fuso", () => {
    expect(formatarPrazo("2026-11-05T00:00:00.000Z", false, dia("2026-11-01T12:00:00Z")).texto).toMatch(/05/);
  });

  it("só vence depois que o dia do prazo termina", () => {
    const prazo = "2026-11-05T00:00:00.000Z";
    expect(formatarPrazo(prazo, false, dia("2026-11-05T20:00:00Z")).vencida).toBe(false);
    expect(formatarPrazo(prazo, false, dia("2026-11-06T01:00:00Z")).vencida).toBe(true);
  });

  it("tarefa feita nunca aparece como atrasada", () => {
    expect(formatarPrazo("2026-01-01T00:00:00.000Z", true, dia("2026-11-06T00:00:00Z")).vencida).toBe(false);
  });
});
