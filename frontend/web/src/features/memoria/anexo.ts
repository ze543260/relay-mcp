import { useQuery } from "@tanstack/react-query";
import { api, ErroApi } from "@/shared/api/cliente";

/**
 * Anexos do relay vistos da memória. O servidor só exibe direto alguns tipos e manda o resto como
 * octet-stream, então o tipo da prévia sai da extensão do nome.
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

const urlDe = (id: string) => `/arquivos/${encodeURIComponent(id)}`;

interface RespostaInfo { id: string; nome: string; tipo: string; tamanho: number }

const comPrevia = (r: RespostaInfo): InfoAnexo => ({ id: r.id, nome: r.nome, tamanho: r.tamanho, url: urlDe(r.id), ...previaDe(r.nome) });

/** Metadados pelo servidor (GET /arquivos/<id>/info), sem baixar o conteúdo. */
const info = async (id: string, sinal?: AbortSignal): Promise<InfoAnexo> =>
  comPrevia(await api<RespostaInfo>(`${urlDe(id)}/info`, { sinal }));

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

/**
 * Anexo de um nó de arquivo: procura nos anexos públicos da sala pelo nome do arquivo
 * (`docs/PLANO-FLUXOS.md` casa com o anexo `PLANO-FLUXOS.md`). Mais novo primeiro.
 */
export function useAnexoDoNo(sala: string, no: string | null) {
  const base = no ? (no.trim().split("/").pop() ?? "").toLowerCase() : "";
  return useQuery({
    queryKey: ["anexos", sala, base],
    queryFn: async ({ signal }) => {
      const lista = await api<RespostaInfo[]>(`/arquivos?${new URLSearchParams({ sala, q: base, limite: "20" })}`, { sinal: signal });
      return lista.find((a) => a.nome.toLowerCase() === base)?.id ?? null;
    },
    enabled: !!base,
    staleTime: 30_000,
  });
}
