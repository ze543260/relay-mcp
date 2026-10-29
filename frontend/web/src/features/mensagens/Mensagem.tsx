import { CheckCheckIcon, CheckIcon, EllipsisIcon, FileCodeIcon } from "lucide-react";
import { lazy, memo, Suspense, useContext, useState } from "react";
import { AbrirArtefatoContexto } from "@/features/artefatos/api";
import { AbrirPerfilContexto } from "@/features/perfil/api";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ListaAnexos } from "./Anexos";
import { cn } from "@/lib/utils";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { corDe, ehIa, horaDe, instanteDe, resumo, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { FotoPerfil } from "@/features/perfil/FotoPerfil";

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
  /** Continuação de uma mensagem do mesmo autor: sem avatar nem nome (hora e ações no hover). */
  seguida?: boolean;
  /** Tocar na citação pula pra mensagem original. */
  aoIrPara?: (id: number) => void;
  /** Apelido do autor, se houver (mostrado no lugar do nome, com o nome ao lado). */
  apelido?: string | null;
  /** Abre "Dados da mensagem" (quem leu). */
  aoInfo?: (m: TMensagem) => void;
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
  const { m, minha, mencionaMe, citada, podeApagar, aoResponder, aoApagar, estado, aoTentar, aoDescartar, aoInfo, vistaPorTodos, apelido, aoEditar, seguida, aoIrPara } = props;
  const ms = instanteDe(m);
  // A lista virtual remonta itens ao rolar: só anima o que acabou de chegar.
  const [recente] = useState(() => Date.now() - ms < RECENTE_MS);
  const [acoes, setAcoes] = useState(false);
  const abrirPerfil = useContext(AbrirPerfilContexto);
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
    if (artefato) return <CartaoArtefato id={Number(artefato[1])} texto={m.texto.replace(/\[\[artefato:\d+\]\]/g, "").replace(/\s{2,}/g, " ")} ms={ms} />;
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
    <article className={cn("group/msg flex max-w-full gap-2 md:max-w-[760px] md:gap-3", minha && "ml-auto flex-row-reverse", seguida && "-mt-2",
      recente && "motion-safe:animate-[entra_var(--mov-padrao)_var(--mov-curva)]")}>
      {/* IA = círculo, humano = quadrado arredondado. Seguida: espaço do avatar, sem avatar. */}
      {seguida ? <span aria-hidden className="w-7 flex-none md:w-8" /> : <Avatar aria-hidden className={cn("size-7 md:size-8", !ehIa(m.de) && "rounded-lg after:rounded-lg")}>
        <FotoPerfil nome={m.de} className={cn(!ehIa(m.de) && "rounded-lg")} />
        <AvatarFallback className={cn("text-[10.5px] font-semibold tracking-wide text-white md:text-[11.5px]", !ehIa(m.de) && "rounded-lg")}
          style={{ background: corDe(m.de) }}>
          {siglaDe(m.de)}
        </AvatarFallback>
      </Avatar>}
      <div className={cn("min-w-0 flex-1", minha && "flex flex-col items-end")}>
        <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", minha && "flex-row-reverse",
          seguida && "h-4 opacity-0 transition-opacity duration-[var(--mov-rapido)] group-hover/msg:opacity-100 group-focus-within/msg:opacity-100")}>
          {seguida ? <span className="sr-only">{apelido ?? m.de}</span> : <>
          <button type="button" onClick={() => abrirPerfil(m.de)} aria-label={textos.perfil.abrir(apelido ?? m.de)}
            className="rounded-sm text-[13px] font-semibold text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">{apelido ?? m.de}</button>
          {apelido && <span className="font-mono text-[11px]">{m.de}</span>}
          {m.para && <span className="text-primary">→ {m.para}</span>}
          </>}
          <time dateTime={new Date(ms).toISOString()} className="tabular-nums">{horaDe(ms)}</time>
          {m.editado && <span className="italic">({t.editada})</span>}
          {estado === "enviando" && <span>{t.enviando}</span>}
          {estado === "erro" && <span className="text-destructive">{t.falhou}</span>}
          {minha && estado === undefined && vistaPorTodos !== undefined && (
            <button type="button" onClick={() => aoInfo?.(m)} aria-label={`${vistaPorTodos ? t.vistaPorTodos : t.entregue}. ${t.infoTitulo}`}
              title={t.infoTitulo} className="-m-1 rounded-sm p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              {vistaPorTodos
                ? <CheckCheckIcon key="lida" aria-hidden className="size-3.5 text-primary motion-safe:animate-[pop_150ms_var(--mov-curva)]" />
                : <CheckIcon key="entregue" aria-hidden className="size-3.5 motion-safe:animate-[pop_150ms_var(--mov-curva)]" />}
            </button>
          )}
          {confirmada && (acoes ? (
            <Suspense fallback={<Button variant="ghost" size="icon-xs" className={GATILHO} disabled aria-label={t.acoes}><EllipsisIcon /></Button>}>
              <AcoesMensagem m={m} podeApagar={Boolean(podeApagar)} classeGatilho={minha ? GATILHO.replace("ml-auto", "mr-auto") : GATILHO} aoResponder={aoResponder} aoApagar={aoApagar} aoInfo={aoInfo && (() => aoInfo(m))}
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
            // Menção que acabou de chegar: a borda acende uma vez.
            mencionaMe && !minha && recente && "motion-safe:animate-[acende_600ms_var(--mov-curva)]",
            estado === "enviando" && "opacity-60",
            estado === "erro" && "border-destructive/60",
          )}>
            {(citada || m.reply_to) && (
              <blockquote className="mb-2 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground not-italic">
                {m.reply_to && aoIrPara ? (
                  <button type="button" onClick={() => aoIrPara(m.reply_to!)} aria-label={t.irParaOriginal(citada?.de ?? "")}
                    className="w-full rounded-sm text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    {citada ? <><b className="font-medium text-foreground">{citada.de}</b> {resumo(citada.texto)}</> : t.citacaoIndisponivel}
                  </button>
                ) : citada ? <><b className="font-medium text-foreground">{citada.de}</b> {resumo(citada.texto)}</> : t.citacaoIndisponivel}
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
