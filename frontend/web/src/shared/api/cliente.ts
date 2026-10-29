import type { Mensagem, RespostaMensagens } from "./tipos";

export type ModoAuth = "bearer" | "cookie";

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string | null;
  readonly retryAfter: number | null;

  constructor(status: number, codigo: string | null, detalhe: string | null, retryAfter: number | null) {
    super(detalhe ?? codigo ?? `HTTP ${status}`);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.retryAfter = retryAfter;
  }
}

interface CorpoErro {
  codigo?: string;
  detail?: string;
  erro?: string;
}

const credenciais: { modo: ModoAuth; token: string } = { modo: "bearer", token: "" };

export function configurarAuth(modo: ModoAuth, token: string): void {
  credenciais.modo = modo;
  credenciais.token = token;
}

interface Opcoes {
  metodo?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  corpo?: unknown;
  sinal?: AbortSignal;
}

export async function api<T>(caminho: string, { metodo = "GET", corpo, sinal }: Opcoes = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Relay": "1" };
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (credenciais.modo === "bearer" && credenciais.token) headers.Authorization = `Bearer ${credenciais.token}`;

  const r = await fetch(caminho, {
    method: metodo,
    headers,
    signal: sinal,
    credentials: "same-origin",
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (r.status === 204) return undefined as T;

  const dados: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    // RFC 9457 (codigo/detail), com fallback pro formato antigo {erro}.
    const e = (dados ?? {}) as CorpoErro;
    const ra = Number(r.headers.get("Retry-After"));
    throw new ErroApi(r.status, e.codigo ?? null, e.detail ?? e.erro ?? null, ra > 0 ? ra : null);
  }
  return dados as T;
}

export const listaDe = (r: RespostaMensagens): Mensagem[] => (Array.isArray(r) ? r : r.mensagens);

export const ehAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";
