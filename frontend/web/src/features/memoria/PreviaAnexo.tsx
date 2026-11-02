import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, ExternalLinkIcon, FileIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { tamanhoLegivel } from "@/shared/api/arquivos";
import { textos } from "@/shared/lib/textos";
import { TEXTO_MAX, useInfoAnexo, useTextoAnexo, type InfoAnexo } from "./anexo";

const Markdown = lazy(() => import("@/shared/markdown/Markdown"));
const t = textos.memoria;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", pdf: "application/pdf", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
};

/**
 * Mídia vem como blob com o tipo certo (o servidor manda svg e afins como octet-stream).
 * SVG vira <img>, então script dentro dele não roda.
 */
function useUrlMidia(a: InfoAnexo | undefined) {
  const q = useQuery({
    queryKey: ["anexo", a?.id, "blob"],
    queryFn: async ({ signal }) => {
      const r = await fetch(a!.url, { credentials: "same-origin", headers: { "X-Relay": "1" }, signal });
      if (!r.ok) throw new Error(String(r.status));
      const ext = a!.nome.toLowerCase().split(".").pop() ?? "";
      return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: MIME[ext] ?? "application/octet-stream" }));
    },
    enabled: !!a && ["imagem", "pdf", "audio", "video"].includes(a.previa),
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const url = q.data;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return q;
}

function Corpo({ a }: { a: InfoAnexo }) {
  const texto = useTextoAnexo(a);
  const midia = useUrlMidia(a);
  if (a.previa === "outro") return (
    <div className="grid place-items-center gap-2 rounded-[var(--raio-lg)] border border-dashed p-6 text-center text-sm text-muted-foreground">
      <FileIcon className="size-8 opacity-60" aria-hidden />{t.semPrevia}
    </div>
  );
  if (["markdown", "codigo", "texto"].includes(a.previa)) {
    if (texto.isError) return <p className="text-sm text-destructive">{t.erroAnexo}</p>;
    if (!texto.data) return <Skeleton className="h-60" />;
    const corpo = a.previa === "markdown" ? texto.data.texto
      : a.previa === "codigo" ? `\`\`\`${a.linguagem}\n${texto.data.texto.replaceAll("```", "``​`")}\n\`\`\`` : null;
    return (
      <>
        {corpo !== null ? (
          <div className="text-sm [overflow-wrap:anywhere]">
            <Suspense fallback={<pre className="font-mono text-xs whitespace-pre-wrap">{texto.data.texto}</pre>}><Markdown texto={corpo} /></Suspense>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-[var(--raio-lg)] bg-superficie p-3 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{texto.data.texto}</pre>
        )}
        {texto.data.cortado && <p className="text-xs text-muted-foreground">{t.cortado(tamanhoLegivel(TEXTO_MAX))}</p>}
      </>
    );
  }
  if (midia.isError) return <p className="text-sm text-destructive">{t.erroAnexo}</p>;
  if (!midia.data) return <Skeleton className="h-60" />;
  if (a.previa === "imagem") return <img src={midia.data} alt={a.nome} className="max-h-[60dvh] w-full rounded-[var(--raio-lg)] border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain" />;
  if (a.previa === "pdf") return <iframe src={midia.data} title={a.nome} className="h-[65dvh] w-full rounded-[var(--raio-lg)] border" />;
  if (a.previa === "audio") return <audio src={midia.data} controls className="w-full" />;
  return <video src={midia.data} controls className="max-h-[60dvh] w-full rounded-[var(--raio-lg)] border" />;
}

/** Prévia de um anexo dentro da memória: Markdown formatado, código com realce, imagem, PDF e mídia. */
export default function PreviaAnexo({ id, fechar }: { id: string; fechar?: () => void }) {
  const { data: a, isError } = useInfoAnexo(id);
  return (
    <section aria-label={a?.nome ?? t.anexo} className="grid min-w-0 gap-2">
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{a?.nome ?? "…"}</h3>
        {a?.tamanho != null && <span className="flex-none text-[11px] text-muted-foreground tabular-nums">{tamanhoLegivel(a.tamanho)}</span>}
        <Button size="icon" variant="ghost" className="size-7" aria-label={t.abrirAba} title={t.abrirAba}
          render={<a href={`/arquivos/${encodeURIComponent(id)}`} target="_blank" rel="noopener" />}><ExternalLinkIcon /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t.baixar} title={t.baixar}
          render={<a href={`/arquivos/${encodeURIComponent(id)}?baixar=1`} download={a?.nome} />}><DownloadIcon /></Button>
        {fechar && <Button size="icon" variant="ghost" className="size-7" aria-label={t.fecharPrevia} onClick={fechar}><XIcon /></Button>}
      </div>
      {/* Altura limitada: os fatos do nó continuam à vista logo abaixo. */}
      <div className="max-h-[55dvh] min-w-0 overflow-auto rounded-[var(--raio-lg)] [&_pre]:max-w-full [&_pre]:overflow-x-auto">
        {isError ? <p className="text-sm text-destructive">{t.erroAnexo}</p> : a ? <Corpo a={a} /> : <Skeleton className="h-60" />}
      </div>
    </section>
  );
}
