import { EllipsisIcon } from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ListaAnexos } from "./Anexos";
import { cn } from "@/lib/utils";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { corDe, ehIa, horaDe, instanteDe, resumo, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

// KaTeX + highlight.js e o menu de ações ficam fora do bundle inicial.
const Markdown = lazy(() => import("@/shared/markdown/Markdown"));
const AcoesMensagem = lazy(() => import("./AcoesMensagem"));
const GATILHO = "ml-auto opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100 data-popup-open:opacity-100";

const RECENTE_MS = 5000;
const t = textos.conversa;

interface Props {
  m: TMensagem;
  minha: boolean;
  /** Menciona quem está vendo (@nome): ganha destaque. */
  mencionaMe?: boolean;
  /** Mensagem respondida (reply_to), se estiver carregada. */
  citada?: TMensagem;
  podeApagar?: boolean;
  aoResponder?: (m: TMensagem) => void;
  aoApagar?: (id: number) => void;
  /** Só para mensagens otimistas (ainda não confirmadas pelo servidor). */
  estado?: "enviando" | "erro";
  aoTentar?: () => void;
  aoDescartar?: () => void;
}

export const Mensagem = memo(function Mensagem(props: Props) {
  const { m, minha, mencionaMe, citada, podeApagar, aoResponder, aoApagar, estado, aoTentar, aoDescartar } = props;
  const ms = instanteDe(m);
  // A lista virtual remonta itens ao rolar: só anima o que acabou de chegar.
  const [recente] = useState(() => Date.now() - ms < RECENTE_MS);
  const [acoes, setAcoes] = useState(false);
  const confirmada = estado === undefined;

  // Mensagens do próprio relay (tarefas, reuniões): linha de evento, não bolha.
  if (m.de === "relay") {
    return (
      <div role="note" className="texto texto-sistema mx-auto max-w-[min(100%,640px)] rounded-lg border border-dashed bg-superficie/60 px-3 py-2 text-[13px] text-muted-foreground">
        <Suspense fallback={<p className="whitespace-pre-wrap">{m.texto}</p>}>
          <Markdown texto={m.texto} />
        </Suspense>
        <time dateTime={new Date(ms).toISOString()} className="mt-0.5 block text-right text-[11px] tabular-nums opacity-70">{horaDe(ms)}</time>
      </div>
    );
  }

  return (
    <article className={cn("group/msg flex max-w-full gap-2 md:max-w-[760px] md:gap-3", recente && "motion-safe:animate-[entra_.3s_ease-out]")}>
      {/* IA = círculo, humano = quadrado arredondado. */}
      <Avatar aria-hidden className={cn("size-7 md:size-8", !ehIa(m.de) && "rounded-lg after:rounded-lg")}>
        <AvatarFallback className={cn("text-[10.5px] font-semibold tracking-wide text-white md:text-[11.5px]", !ehIa(m.de) && "rounded-lg")}
          style={{ background: corDe(m.de) }}>
          {siglaDe(m.de)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <b className="text-[13px] font-semibold text-foreground">{m.de}</b>
          {m.para && <span className="text-primary">→ {m.para}</span>}
          <time dateTime={new Date(ms).toISOString()} className="tabular-nums">{horaDe(ms)}</time>
          {estado === "enviando" && <span>{t.enviando}</span>}
          {estado === "erro" && <span className="text-destructive">{t.falhou}</span>}
          {confirmada && (acoes ? (
            <Suspense fallback={<Button variant="ghost" size="icon-xs" className={GATILHO} disabled><EllipsisIcon /></Button>}>
              <AcoesMensagem m={m} podeApagar={Boolean(podeApagar)} classeGatilho={GATILHO} aoResponder={aoResponder} aoApagar={aoApagar} />
            </Suspense>
          ) : (
            <Button variant="ghost" size="icon-xs" aria-label={t.acoes} className={GATILHO} onClick={() => setAcoes(true)}>
              <EllipsisIcon />
            </Button>
          ))}
        </div>
        {(m.texto.trim() || citada || m.reply_to) && (
        <div className={cn(
            "texto mt-1 w-fit max-w-full min-w-0 rounded-[var(--raio-bolha-canto)_var(--raio-bolha)_var(--raio-bolha)_var(--raio-bolha)] border bg-bolha px-3 py-2.5 text-[15px] [overflow-wrap:anywhere] md:px-3.5 md:text-sm",
            minha ? "border-primary/35" : "border-border",
            mencionaMe && !minha && "border-primary/60 bg-primary/8 ring-1 ring-primary/30",
            estado === "enviando" && "opacity-60",
            estado === "erro" && "border-destructive/60",
          )}>
            {(citada || m.reply_to) && (
              <blockquote className="mb-2 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground not-italic">
                {citada ? <><b className="font-medium text-foreground">{citada.de}</b> {resumo(citada.texto)}</> : t.citacaoIndisponivel}
              </blockquote>
            )}
            <Suspense fallback={<p className="whitespace-pre-wrap">{m.texto}</p>}>
              <Markdown texto={m.texto} />
            </Suspense>
          </div>
        )}
        {m.anexos && m.anexos.length > 0 && <ListaAnexos anexos={m.anexos} />}
        {estado === "erro" && (
          <div className="mt-1 flex gap-1">
            <Button size="xs" variant="outline" onClick={aoTentar}>{t.tentarDeNovo}</Button>
            <Button size="xs" variant="ghost" onClick={aoDescartar}>{t.descartar}</Button>
          </div>
        )}
      </div>
    </article>
  );
});
