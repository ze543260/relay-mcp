import { useQueries, useQuery } from "@tanstack/react-query";
import { ErroApi } from "@/shared/api/cliente";
import type { Fato } from "./api";

/**
 * Anexos do relay vistos da memória. O servidor só exibe direto alguns tipos e manda o resto como
 * octet-stream, então o tipo da prévia sai da extensão do nome (que vem no Content-Disposition).
 */
export type TipoPrevia = "markdown" | "codigo" | "texto" | "imagem" | "pdf" | "audio" | "video" | "outro";

export interface InfoAnexo {
  id: string;
  nome: string;
  tamanho: number | null;
  previa: TipoPrevia;
  /** Linguagem do realce, para `codigo`. */
  linguagem: string;
  url: string;
}

const LINGUAGENS: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", sh: "bash", ps1: "powershell", sql: "sql", css: "css", html: "xml", xml: "xml", java: "java",
  kt: "kotlin", go: "go", rs: "rust", c: "c", h: "c", cpp: "cpp", cs: "csharp", rb: "ruby", php: "php", swift: "swift",
  dockerfile: "dockerfile", gradle: "groovy",
};
const POR_EXTENSAO: Record<string, TipoPrevia> = {
  md: "markdown", markdown: "markdown", txt: "texto", log: "texto", csv: "texto",
  png: "imagem", jpg: "imagem", jpeg: "imagem", gif: "imagem", webp: "imagem", avif: "imagem", svg: "imagem",
  pdf: "pdf", mp3: "audio", ogg: "audio", wav: "audio", mp4: "video", webm: "video",
};
export const TEXTO_MAX = 512 * 1024;

const extensao = (nome: string) => (nome.split("/").pop() ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  ?? ((nome.split("/").pop() ?? "").toLowerCase() === "dockerfile" ? "dockerfile" : "");

export function previaDe(nome: string): { previa: TipoPrevia; linguagem: string } {
  const ext = extensao(nome);
  if (POR_EXTENSAO[ext]) return { previa: POR_EXTENSAO[ext]!, linguagem: "" };
  if (LINGUAGENS[ext]) return { previa: "codigo", linguagem: LINGUAGENS[ext]! };
  return { previa: "outro", linguagem: "" };
}

/** `filename*=UTF-8''…` (o servidor manda sempre assim) ou `filename="…"`. */
function nomeDoCabecalho(cd: string | null): string | null {
  if (!cd) return null;
  const estrela = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (estrela) { try { return decodeURIComponent(estrela[1]!); } catch { return estrela[1]!; } }
  return cd.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

const urlDe = (id: string) => `/arquivos/${encodeURIComponent(id)}`;

/** Só os cabeçalhos: o corpo é abortado assim que a resposta chega (não baixa o arquivo inteiro). */
async function info(id: string, sinal?: AbortSignal): Promise<InfoAnexo> {
  const ctl = new AbortController();
  sinal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const r = await fetch(urlDe(id), { credentials: "same-origin", headers: { "X-Relay": "1" }, signal: ctl.signal });
  if (!r.ok) throw new ErroApi(r.status, r.status === 404 ? "arquivo_inexistente" : null, null, null);
  const nome = nomeDoCabecalho(r.headers.get("Content-Disposition")) ?? id;
  const tamanho = Number(r.headers.get("Content-Length")) || null;
  ctl.abort();
  return { id, nome, tamanho, url: urlDe(id), ...previaDe(nome) };
}

export const useInfoAnexo = (id: string | null) => useQuery({
  queryKey: ["anexo", id, "info"],
  queryFn: ({ signal }) => info(id!, signal),
  enabled: id !== null,
  staleTime: Infinity,
  retry: false,
});

/** Texto do anexo para markdown/código/texto, cortado em TEXTO_MAX. */
export const useTextoAnexo = (a: InfoAnexo | undefined) => useQuery({
  queryKey: ["anexo", a?.id, "texto"],
  queryFn: async ({ signal }) => {
    const r = await fetch(a!.url, { credentials: "same-origin", headers: { "X-Relay": "1" }, signal });
    if (!r.ok) throw new ErroApi(r.status, null, null, null);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { texto: new TextDecoder().decode(bytes.subarray(0, TEXTO_MAX)), cortado: bytes.length > TEXTO_MAX };
  },
  enabled: !!a && ["markdown", "codigo", "texto"].includes(a.previa),
  staleTime: Infinity,
});

/** Nome (minúsculo) -> id do anexo, para os anexos citados como origem nos fatos visíveis. */
export function useAnexosPorNome(fatos: Fato[]): Map<string, string> {
  const ids = [...new Set(fatos.filter((f) => f.origem.tipo === "arquivo").map((f) => f.origem.id))];
  const res = useQueries({
    queries: ids.map((id) => ({ queryKey: ["anexo", id, "info"], queryFn: ({ signal }: { signal: AbortSignal }) => info(id, signal), staleTime: Infinity, retry: false })),
  });
  const mapa = new Map<string, string>();
  for (const q of res) if (q.data) mapa.set(q.data.nome.toLowerCase(), q.data.id);
  return mapa;
}

/** Acha o anexo de um nó pelo nome do arquivo (`docs/PLANO.md` casa com o anexo `PLANO.md`). */
export const anexoDoNo = (no: string, porNome: Map<string, string>): string | null =>
  porNome.get(no.trim().toLowerCase()) ?? porNome.get((no.trim().split("/").pop() ?? "").toLowerCase()) ?? null;
