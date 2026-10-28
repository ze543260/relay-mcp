import { CopyIcon, CornerUpLeftIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { corDe, ehIa, horaDe, instanteDe, resumo, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

// KaTeX + highlight.js ficam fora do bundle inicial.
const Markdown = lazy(() => import("@/shared/markdown/Markdown"));

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
  const [confirmando, setConfirmando] = useState(false);
  const confirmada = estado === undefined;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(m.texto);
      toast.success(t.copiada);
    } catch {
      toast.error(t.naoCopiou);
    }
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
          {confirmada && (
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button variant="ghost" size="icon-xs" aria-label={t.acoes}
                  className="ml-auto opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100 data-popup-open:opacity-100" />
              }>
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onClick={() => aoResponder?.(m)}><CornerUpLeftIcon /> {t.responder}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void copiar()}><CopyIcon /> {t.copiar}</DropdownMenuItem>
                {podeApagar && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setConfirmando(true)}><Trash2Icon /> {t.apagar}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className={cn(
          "texto mt-1 w-fit max-w-full min-w-0 rounded-[4px_12px_12px_12px] border bg-bolha px-3 py-2.5 text-[15px] [overflow-wrap:anywhere] md:px-3.5 md:text-sm",
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
        {estado === "erro" && (
          <div className="mt-1 flex gap-1">
            <Button size="xs" variant="outline" onClick={aoTentar}>{t.tentarDeNovo}</Button>
            <Button size="xs" variant="ghost" onClick={aoDescartar}>{t.descartar}</Button>
          </div>
        )}
      </div>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.apagarTitulo}</AlertDialogTitle>
            <AlertDialogDescription>{t.apagarDescricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => aoApagar?.(m.id)}>{t.apagar}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
});
