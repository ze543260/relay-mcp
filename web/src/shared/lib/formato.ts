import type { Mensagem } from "../api/tipos";

const CORES = ["#c96442", "#3b7dd8", "#2f8f5b", "#8b5cf6", "#d4a017", "#d0453a", "#0e9aa7", "#b4529b"] as const;

export function corDe(nome: string): string {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length] ?? CORES[0];
}

export const siglaDe = (nome: string): string => (nome.replace(/^claude-/, "") || nome).slice(0, 2).toUpperCase();

/** Claudes e bots (modelos locais) contam como IA; o resto é humano. */
export const ehIa = (nome: string): boolean => /^(claude|gemma|qwen|llama|gpt)/.test(nome);

export const instanteDe = (m: Mensagem): number =>
  m.criado_em ? Date.parse(m.criado_em) : (m.criado ?? 0) * 1000;

const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDiaHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function horaDe(ms: number): string {
  const d = new Date(ms);
  return (new Date().toDateString() === d.toDateString() ? fmtHora : fmtDiaHora).format(d);
}

// crypto.randomUUID só existe em contexto seguro (HTTPS/localhost); pelo IP do Tailscale é http.
export const novoId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// "José Vitor" → "jose-vitor": tira acento antes de filtrar, senão a letra some junto.
export const normalizarNome = (bruto: string): string =>
  bruto.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w.-]/g, "").slice(0, 32);
