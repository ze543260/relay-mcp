import { lazy, memo, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { textos } from "@/shared/lib/textos";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { corDe, ehIa, horaDe, instanteDe, siglaDe } from "@/shared/lib/formato";

// KaTeX + highlight.js ficam fora do bundle inicial.
const Markdown = lazy(() => import("@/shared/markdown/Markdown"));

const RECENTE_MS = 5000;

interface Props {
  m: TMensagem;
  minha: boolean;
  /** Só para mensagens otimistas (ainda não confirmadas pelo servidor). */
  estado?: "enviando" | "erro";
  aoTentar?: () => void;
  aoDescartar?: () => void;
}

export const Mensagem = memo(function Mensagem({ m, minha, estado, aoTentar, aoDescartar }: Props) {
  const ms = instanteDe(m);
  // A lista virtual remonta itens ao rolar: só anima o que acabou de chegar.
  const [recente] = useState(() => Date.now() - ms < RECENTE_MS);
  return (
    <article className={cn("flex max-w-full gap-2 md:max-w-[760px] md:gap-3", recente && "motion-safe:animate-[entra_.3s_ease-out]")}>
      {/* IA = círculo, humano = quadrado arredondado. */}
      <Avatar aria-hidden className={cn("size-7 md:size-8", !ehIa(m.de) && "rounded-lg after:rounded-lg")}>
        <AvatarFallback className={cn("text-[10.5px] font-semibold tracking-wide text-white md:text-[11.5px]", !ehIa(m.de) && "rounded-lg")}
          style={{ background: corDe(m.de) }}>
          {siglaDe(m.de)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <b className="text-[13px] font-semibold text-foreground">{m.de}</b>
          {m.para && <span className="text-acento">→ {m.para}</span>}
          <time dateTime={new Date(ms).toISOString()} className="tabular-nums">{horaDe(ms)}</time>
          {estado === "enviando" && <span>{textos.conversa.enviando}</span>}
          {estado === "erro" && <span className="text-destructive">{textos.conversa.falhou}</span>}
        </div>
        <div className={`texto mt-1 ${estado === "enviando" ? "opacity-60" : ""} ${estado === "erro" ? "border-destructive/60!" : ""} min-w-0 rounded-[4px_12px_12px_12px] border bg-bolha px-3 py-2.5 text-[15px] [overflow-wrap:anywhere] md:px-3.5 md:text-sm ${minha ? "border-acento/35" : "border-border"}`}>
          <Suspense fallback={<p className="whitespace-pre-wrap">{m.texto}</p>}>
            <Markdown texto={m.texto} />
          </Suspense>
        </div>
        {estado === "erro" && (
          <div className="mt-1 flex gap-1">
            <Button size="xs" variant="outline" onClick={aoTentar}>{textos.conversa.tentarDeNovo}</Button>
            <Button size="xs" variant="ghost" onClick={aoDescartar}>{textos.conversa.descartar}</Button>
          </div>
        )}
      </div>
    </article>
  );
});
