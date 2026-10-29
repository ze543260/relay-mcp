import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { textos } from "@/shared/lib/textos";
import type { TipoArtefato } from "./api";

const Markdown = lazy(() => import("@/shared/markdown/Markdown"));
const t = textos.artefatos;

// CSP do mockup: nada sai pra rede (nem fetch, nem imagem externa, nem form). Só o próprio conteúdo.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** HTML de agente roda numa origem opaca: sem cookie, sem storage do relay, sem acesso ao app, sem rede. */
function Html({ conteudo, titulo }: { conteudo: string; titulo: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${conteudo}</body></html>`;
  return (
    <iframe title={t.mockup(titulo)} srcDoc={doc} sandbox="allow-scripts" referrerPolicy="no-referrer"
      className="h-[70vh] w-full rounded-[var(--raio-lg)] border bg-white" />
  );
}

/** SVG como <img>: script dentro de SVG não roda em imagem. */
function Svg({ conteudo, titulo }: { conteudo: string; titulo: string }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(conteudo)}`;
  return <img src={src} alt={titulo} className="mx-auto max-h-[70vh] max-w-full rounded-[var(--raio-lg)] border bg-white p-2" />;
}

function Mermaid({ conteudo }: { conteudo: string }) {
  const id = `mmd-${useId().replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        const escuro = document.documentElement.dataset.theme === "dark"
          || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: escuro ? "dark" : "default", htmlLabels: false, flowchart: { htmlLabels: false } });
        const { svg: s } = await mermaid.render(id, conteudo);
        if (vivo) { setSvg(s); setErro(null); }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; };
  }, [conteudo, id]);
  if (erro) return <pre className="overflow-auto rounded-[var(--raio-lg)] border border-destructive/50 p-3 text-xs text-destructive">{t.erroDiagrama(erro)}</pre>;
  if (!svg) return <Skeleton className="h-48" />;
  // Com securityLevel "strict" o mermaid sanitiza o SVG (sem script/handlers); vira imagem pra garantir.
  return <img alt={t.diagrama} className="mx-auto max-w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />;
}

export default function Visualizador({ tipo, conteudo, titulo }: { tipo: TipoArtefato; conteudo: string; titulo: string }) {
  if (tipo === "html") return <Html conteudo={conteudo} titulo={titulo} />;
  if (tipo === "svg") return <Svg conteudo={conteudo} titulo={titulo} />;
  if (tipo === "mermaid") return <Mermaid conteudo={conteudo} />;
  return (
    <div className="texto text-sm [overflow-wrap:anywhere]">
      <Suspense fallback={<pre className="whitespace-pre-wrap">{conteudo}</pre>}><Markdown texto={conteudo} /></Suspense>
    </div>
  );
}
