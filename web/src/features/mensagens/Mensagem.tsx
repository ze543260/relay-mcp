import { CheckCheckIcon, CheckIcon, EllipsisIcon, FileCodeIcon } from "lucide-react";
import { lazy, memo, Suspense, useContext, useState } from "react";
import { AbrirArtefatoContexto } from "@/features/artefatos/api";
import { Textarea } from "@/components/ui/textarea";
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
  /** Só nas minhas: salva o texto novo (true = deu certo). */
  aoEditar?: (id: number, texto: string) => Promise<boolean>;
  /** Apelido do autor, se houver (mostrado no lugar do nome, com o nome ao lado). */
  apelido?: string | null;
  /** Quem tem esta como última mensagem lida (avatares pequenos embaixo). */
  vistoPor?: string[];
  /** Minha mensagem: true = todos leram (✓✓), false = entregue (✓). */
  vistaPorTodos?: boolean;
  /** Só para mensagens otimistas (ainda não confirmadas pelo servidor). */
  estado?: "enviando" | "erro";
  aoTentar?: () => void;
  aoDescartar?: () => void;
}

/** Cartão de artefato na conversa (criado, aprovado, arquivado): abre o painel ao clicar. */
function CartaoArtefato({ id, texto, ms }: { id: number; texto: string; ms: number }) {
  const abrir = useContext(AbrirArtefatoContexto);
  return (
    <div role="note" className="texto texto-sistema mx-auto flex max-w-[min(100%,640px)] items-center gap-3 rounded-lg border border-dashed bg-superficie/60 px-3 py-2 text-[13px] text-muted-foreground">
      <div className="min-w-0 flex-1">
        <Suspense fallback={<p className="whitespace-pre-wrap">{texto}</p>}><Markdown texto={texto} /></Suspense>
        <time dateTime={new Date(ms).toISOString()} className="block text-[11px] tabular-nums opacity-70">{horaDe(ms)}</time>
      </div>
      <Button size="sm" variant="outline" onClick={() => abrir(id)} aria-label={textos.artefatos.abrir(`#${id}`)}>
        <FileCodeIcon />{textos.artefatos.abrirCurto}
      </Button>
    </div>
  );
}

export const Mensagem = memo(function Mensagem(props: Props) {
  const { m, minha, mencionaMe, citada, podeApagar, aoResponder, aoApagar, estado, aoTentar, aoDescartar, vistoPor, vistaPorTodos, apelido, aoEditar } = props;
  const ms = instanteDe(m);
  // A lista virtual remonta itens ao rolar: só anima o que acabou de chegar.
  const [recente] = useState(() => Date.now() - ms < RECENTE_MS);
  const [acoes, setAcoes] = useState(false);
  const confirmada = estado === undefined;
  const [editando, setEditando] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const novo = editando?.trim();
    if (!novo || novo === m.texto.trim()) return setEditando(null);
    setSalvando(true);
    if (await aoEditar?.(m.id, novo)) setEditando(null);
    setSalvando(false);
  }

  // Mensagens do próprio relay (tarefas, reuniões): linha de evento, não bolha.
  if (m.de === "relay") {
    const artefato = /\[\[artefato:(\d+)\]\]/.exec(m.texto);
    if (artefato) return <CartaoArtefato id={Number(artefato[1])} texto={m.texto.replace(artefato[0], "").replace(/\s{2,}/g, " ")} ms={ms} />;
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
    <article className={cn("group/msg flex max-w-full gap-2 md:max-w-[760px] md:gap-3", minha && "ml-auto flex-row-reverse", recente && "motion-safe:animate-[entra_.3s_ease-out]")}>
      {/* IA = círculo, humano = quadrado arredondado. */}
      <Avatar aria-hidden className={cn("size-7 md:size-8", !ehIa(m.de) && "rounded-lg after:rounded-lg")}>
        <AvatarFallback className={cn("text-[10.5px] font-semibold tracking-wide text-white md:text-[11.5px]", !ehIa(m.de) && "rounded-lg")}
          style={{ background: corDe(m.de) }}>
          {siglaDe(m.de)}
        </AvatarFallback>
      </Avatar>
      <div className={cn("min-w-0 flex-1", minha && "flex flex-col items-end")}>
        <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", minha && "flex-row-reverse")}>
          <b className="text-[13px] font-semibold text-foreground">{apelido ?? m.de}</b>
          {apelido && <span className="font-mono text-[11px]">{m.de}</span>}
          {m.para && <span className="text-primary">→ {m.para}</span>}
          <time dateTime={new Date(ms).toISOString()} className="tabular-nums">{horaDe(ms)}</time>
          {m.editado && <span className="italic">({t.editada})</span>}
          {estado === "enviando" && <span>{t.enviando}</span>}
          {estado === "erro" && <span className="text-destructive">{t.falhou}</span>}
          {minha && estado === undefined && vistaPorTodos !== undefined && (
            vistaPorTodos
              ? <CheckCheckIcon className="size-3.5 text-primary" aria-label={t.vistaPorTodos} />
              : <CheckIcon className="size-3.5" aria-label={t.entregue} />
          )}
          {confirmada && (acoes ? (
            <Suspense fallback={<Button variant="ghost" size="icon-xs" className={GATILHO} disabled><EllipsisIcon /></Button>}>
              <AcoesMensagem m={m} podeApagar={Boolean(podeApagar)} classeGatilho={minha ? GATILHO.replace("ml-auto", "mr-auto") : GATILHO} aoResponder={aoResponder} aoApagar={aoApagar}
                aoEditar={aoEditar && m.texto.trim() ? () => setEditando(m.texto) : undefined} />
            </Suspense>
          ) : (
            <Button variant="ghost" size="icon-xs" aria-label={t.acoes} className={minha ? GATILHO.replace("ml-auto", "mr-auto") : GATILHO} onClick={() => setAcoes(true)}>
              <EllipsisIcon />
            </Button>
          ))}
        </div>
        {editando !== null ? (
          <div className="mt-1 w-full max-w-[600px]">
            <Textarea autoFocus value={editando} disabled={salvando} aria-label={t.editar} className="min-h-16 text-[15px] md:text-sm"
              onChange={(e) => setEditando(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditando(null);
                else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void salvar(); }
              }} />
            <div className="mt-1 flex items-center justify-end gap-1">
              <span className="mr-auto text-[11px] text-muted-foreground">{t.editarDica}</span>
              <Button size="xs" variant="ghost" onClick={() => setEditando(null)}>{t.cancelar}</Button>
              <Button size="xs" disabled={salvando} onClick={() => void salvar()}>{t.salvar}</Button>
            </div>
          </div>
        ) : (m.texto.trim() || citada || m.reply_to) && (
        <div className={cn(
            "texto mt-1 w-fit max-w-full min-w-0 border bg-bolha",
            minha ? "rounded-[var(--raio-bolha)_var(--raio-bolha-canto)_var(--raio-bolha)_var(--raio-bolha)]" : "rounded-[var(--raio-bolha-canto)_var(--raio-bolha)_var(--raio-bolha)_var(--raio-bolha)]",
            " px-3 py-2.5 text-[15px] [overflow-wrap:anywhere] md:px-3.5 md:text-sm",
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
        {vistoPor && vistoPor.length > 0 && (
          <div className="mt-1 flex items-center justify-end gap-0.5" aria-label={t.vistoPor(vistoPor.join(", "))} title={t.vistoPor(vistoPor.join(", "))}>
            {vistoPor.slice(0, 6).map((n) => (
              <span key={n} aria-hidden className={cn("grid size-4 place-items-center text-[7px] font-semibold text-white ring-2 ring-background", ehIa(n) ? "rounded-full" : "rounded-[3px]")}
                style={{ background: corDe(n) }}>{siglaDe(n)}</span>
            ))}
            {vistoPor.length > 6 && <span className="text-[10px] text-muted-foreground">+{vistoPor.length - 6}</span>}
          </div>
        )}
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
