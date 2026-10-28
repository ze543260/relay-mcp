import { describe, expect, it } from "vitest";
import { formatarPrazo, quandoMudou } from "./prazo";

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

  it("histórico: hoje só a hora, outro dia com a data", () => {
    const agora = new Date(2026, 9, 28, 15, 0);
    expect(quandoMudou(new Date(2026, 9, 28, 9, 5).toISOString(), agora)).toBe("09:05");
    expect(quandoMudou(new Date(2026, 9, 27, 9, 5).toISOString(), agora)).toMatch(/27\/10/);
  });

  it("tarefa feita nunca aparece como atrasada", () => {
    expect(formatarPrazo("2026-01-01T00:00:00.000Z", true, dia("2026-11-06T00:00:00Z")).vencida).toBe(false);
  });
});
