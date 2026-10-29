import { DownloadIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileTextIcon, FileVideoIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ehImagem, tamanhoLegivel } from "@/shared/api/arquivos";
import type { Anexo } from "@/shared/api/tipos";
import { textos } from "@/shared/lib/textos";

const t = textos.anexos;

function IconeArquivo({ tipo }: { tipo: string }) {
  const C = tipo.startsWith("audio/") ? FileAudioIcon : tipo.startsWith("video/") ? FileVideoIcon
    : tipo.startsWith("text/") || tipo === "application/pdf" ? FileTextIcon
    : /zip|tar|gzip|7z|rar/.test(tipo) ? FileArchiveIcon : FileIcon;
  return <C className="size-5 flex-none text-primary" aria-hidden />;
}

/** Imagem em tela cheia (Esc ou clique fora fecha). Sem dependências: portal + foco no botão. */
function Visualizador({ anexo, aoFechar }: { anexo: Anexo; aoFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar]);
  return createPortal(
    <div role="dialog" aria-modal aria-label={anexo.nome} onClick={aoFechar}
      className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 motion-safe:animate-in motion-safe:fade-in-0">
      <img src={anexo.url} alt={anexo.nome} onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] max-w-full rounded-lg object-contain shadow-2xl" />
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex gap-2">
        <a href={`${anexo.url}?baixar=1`} download={anexo.nome} onClick={(e) => e.stopPropagation()} aria-label={t.baixar}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><DownloadIcon className="size-5" /></a>
        <button autoFocus onClick={aoFechar} aria-label={t.fechar}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><XIcon className="size-5" /></button>
      </div>
      <p className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-[90%] truncate text-sm text-white/80">{anexo.nome}</p>
    </div>,
    document.body,
  );
}

/** Imagens em grade (clique amplia) e demais arquivos como cartões de download. */
export function ListaAnexos({ anexos }: { anexos: Anexo[] }) {
  const [aberto, setAberto] = useState<Anexo | null>(null);
  const imagens = anexos.filter((a) => ehImagem(a.tipo));
  const outros = anexos.filter((a) => !ehImagem(a.tipo));
  return (
    <div className="mt-1.5 grid gap-1.5">
      {imagens.length > 0 && (
        <div className={cn("grid gap-1.5", imagens.length > 1 && "grid-cols-2")}>
          {imagens.map((a) => (
            <button key={a.id} type="button" onClick={() => setAberto(a)} aria-label={t.ampliar(a.nome)}
              className="overflow-hidden rounded-[var(--raio-bolha)] border bg-superficie focus-visible:ring-2 focus-visible:ring-ring">
              <img src={a.url} alt={a.nome} loading="lazy" decoding="async"
                className={cn("block w-full object-cover", imagens.length > 1 ? "aspect-square" : "max-h-80 w-auto max-w-full")} />
            </button>
          ))}
        </div>
      )}
      {outros.map((a) => (
        <a key={a.id} href={`${a.url}?baixar=1`} download={a.nome}
          className="flex max-w-80 items-center gap-3 rounded-[var(--raio-xl)] border bg-card px-3 py-2.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <IconeArquivo tipo={a.tipo} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-medium">{a.nome}</span>
            <span className="text-xs text-muted-foreground">{tamanhoLegivel(a.tamanho)}</span>
          </span>
          <DownloadIcon className="size-4 text-muted-foreground" aria-hidden />
        </a>
      ))}
      {aberto && <Visualizador anexo={aberto} aoFechar={() => setAberto(null)} />}
    </div>
  );
}
