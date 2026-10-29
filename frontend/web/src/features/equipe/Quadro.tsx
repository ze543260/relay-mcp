import { CalendarIcon, CheckSquareIcon, ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type FormEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { corDe, ehIa, horaDe, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { PRIORIDADES, STATUS, useEquipe, useEtiquetas, useSprints, useTarefas, type Prioridade, type Status, type Tarefa } from "./api";
import { ChipEtiqueta, IconePrioridade } from "./pecas";
import { formatarPrazo } from "./prazo";
import { FotoPerfil } from "@/features/perfil/FotoPerfil";

const PainelTarefa = lazy(() => import("./PainelTarefa"));

const t = textos.equipe;

/** Descrição em Markdown como texto corrido, para a prévia de 2 linhas do cartão. */
const previa = (md: string): string => md
  .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
  .replace(/[*_`~]+/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

/** Linha de metadados do cartão: só aparece o que a tarefa tem. */
function Meta({ tarefa }: { tarefa: Tarefa }) {
  const prazo = tarefa.prazo ? formatarPrazo(tarefa.prazo, tarefa.status === "feito") : null;
  const { feitos, total } = tarefa.checklist;
  if (!prazo && !total && !tarefa.estimativa && !tarefa.etiquetas.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-muted-foreground tabular-nums">
      {tarefa.etiquetas.map((e) => <ChipEtiqueta key={e.id} etiqueta={e} />)}
      {total > 0 && (
        <span className={cn("inline-flex items-center gap-1", feitos === total && "text-primary")} title={t.checklistResumo(feitos, total)}>
          <CheckSquareIcon aria-hidden className="size-3" />{feitos}/{total}
        </span>
      )}
      {prazo && (
        <span className={cn("inline-flex items-center gap-1", prazo.vencida && "font-medium text-destructive")}>
          <CalendarIcon aria-hidden className="size-3" />{prazo.vencida ? t.atrasada(prazo.texto) : t.prazo(prazo.texto)}
        </span>
      )}
      {tarefa.estimativa && <Badge variant="outline" className="h-4 px-1 text-[10px]">{t.pontos(tarefa.estimativa)}</Badge>}
    </div>
  );
}

function Responsavel({ nome }: { nome: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar aria-hidden className={cn("size-5", !ehIa(nome) && "rounded-md after:rounded-md")}>
        <FotoPerfil nome={nome} className={cn(!ehIa(nome) && "rounded-md")} />
        <AvatarFallback className={cn("text-[8.5px] font-semibold text-white", !ehIa(nome) && "rounded-md")} style={{ background: corDe(nome) }}>
          {siglaDe(nome)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{nome}</span>
    </span>
  );
}

function Cartao({ tarefa, eu, admin, mover, pegar, apagar, abrir }: {
  tarefa: Tarefa; eu: string; admin: boolean;
  mover: (s: Status) => void; pegar: () => void; apagar: () => void; abrir: () => void;
}) {
  const i = STATUS.indexOf(tarefa.status);
  return (
    <article className={cn("group/cartao relative grid min-w-0 gap-2 rounded-[var(--raio-xl)] border bg-card p-3 shadow-xs transition-colors hover:border-ring/40",
      // Faixa interna (não a borda): acompanha o canto arredondado sem entortar.
      tarefa.prioridade === "urgente" && tarefa.status !== "feito"
        && "before:absolute before:inset-y-3 before:left-1 before:w-0.5 before:rounded-full before:bg-destructive")}>
      <div className="flex items-start gap-2">
        <span className="flex items-center gap-1 pt-px font-mono text-xs text-muted-foreground">
          #{tarefa.id}<IconePrioridade prioridade={tarefa.prioridade} />
        </span>
        <button type="button" onClick={abrir} aria-label={t.abrirTarefa(tarefa.id)}
          className="min-w-0 flex-1 rounded-sm text-left text-sm leading-snug font-medium [overflow-wrap:break-word] hyphens-auto hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {tarefa.titulo}
        </button>
        {(admin || tarefa.criada_por === eu) && (
          <Button variant="ghost" size="icon-xs" aria-label={t.apagar} onClick={apagar}
            className="opacity-100 md:opacity-0 md:group-hover/cartao:opacity-100 md:focus-visible:opacity-100"><Trash2Icon /></Button>
        )}
      </div>
      {tarefa.descricao && <p className="line-clamp-2 text-xs text-muted-foreground">{previa(tarefa.descricao)}</p>}
      <Meta tarefa={tarefa} />
      <div className="flex items-center gap-1">
        {tarefa.responsavel ? <Responsavel nome={tarefa.responsavel} /> : (
          <Button variant="outline" size="xs" onClick={pegar}>{t.pegar}</Button>
        )}
        <span className="ml-auto flex">
          <Button variant="ghost" size="icon-xs" aria-label={t.voltar} disabled={i === 0} onClick={() => mover(STATUS[i - 1]!)}><ChevronLeftIcon /></Button>
          <Button variant="ghost" size="icon-xs" aria-label={t.avancar} disabled={i === STATUS.length - 1} onClick={() => mover(STATUS[i + 1]!)}><ChevronRightIcon /></Button>
        </span>
      </div>
      <time className="text-[11px] text-muted-foreground tabular-nums">{t.atualizada(horaDe(Date.parse(tarefa.atualizado_em)))}</time>
    </article>
  );
}

/** Quadro kanban da sala, com a sprint ativa no topo. */
export default function Quadro({ sala, eu, admin, abrir }: { sala: string; eu: string; admin: boolean; abrir?: number | null }) {
  const { data: tarefas, isPending } = useTarefas(sala);
  const { data: sprints } = useSprints(sala);
  const { data: etiquetas } = useEtiquetas(sala);
  const eq = useEquipe(sala);
  const [titulo, setTitulo] = useState("");
  const [nomeSprint, setNomeSprint] = useState("");
  const [criandoSprint, setCriandoSprint] = useState(false);
  const [aberta, setAberta] = useState<number | null>(abrir ?? null);
  // Vindo da busca (Ctrl+K): abre a tarefa pedida.
  const [pedida, setPedida] = useState(abrir);
  if (abrir !== pedida) { setPedida(abrir); if (abrir) setAberta(abrir); }
  // O painel (com Markdown/KaTeX) só baixa quando a pessoa chega perto do quadro, e daí fica montado.
  const [painelPronto, setPainelPronto] = useState(false);
  const prepararPainel = () => setPainelPronto(true);
  const [busca, setBusca] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade | "">("");
  const [etiqueta, setEtiqueta] = useState("");
  const ativa = sprints?.find((s) => s.ativa);
  const filtrando = Boolean(busca.trim() || prioridade || etiqueta);

  // Filtro no cliente: a lista da sala já vem inteira e na ordem da fila do servidor.
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (tarefas ?? []).filter((x) =>
      (!prioridade || x.prioridade === prioridade)
      && (!etiqueta || x.etiquetas.some((e) => e.nome.toLowerCase() === etiqueta.toLowerCase()))
      && (!termo || `#${x.id} ${x.titulo} ${x.descricao ?? ""}`.toLowerCase().includes(termo)));
  }, [tarefas, busca, prioridade, etiqueta]);
  const membros = useMemo(() => [...new Set([eu, ...(tarefas ?? []).flatMap((x) => [x.responsavel, x.criada_por])
    .filter((n): n is string => Boolean(n) && n !== "relay")])].sort(), [tarefas, eu]);

  function criar(e: FormEvent) {
    e.preventDefault();
    const tt = titulo.trim();
    if (!tt) return;
    eq.criarTarefa.mutate({ titulo: tt, ...(ativa ? { sprint_id: ativa.id } : {}) }, { onSuccess: () => setTitulo("") });
  }

  function abrirSprint(e: FormEvent) {
    e.preventDefault();
    if (!nomeSprint.trim()) return;
    eq.criarSprint.mutate({ nome: nomeSprint.trim(), dias: 7 }, { onSuccess: () => { setNomeSprint(""); setCriandoSprint(false); } });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <FlagIcon className="size-4 text-primary" aria-hidden />
        {ativa ? (
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex items-baseline gap-2 text-sm">
              <b className="truncate font-semibold">{ativa.nome}</b>
              <span className="text-xs text-muted-foreground tabular-nums">{t.progresso(ativa.feitas, ativa.total)}</span>
              {ativa.fim_em && <span className="text-xs text-muted-foreground">{t.ate(new Date(ativa.fim_em).toLocaleDateString("pt-BR"))}</span>}
            </div>
            <Progress value={ativa.total ? (100 * ativa.feitas) / ativa.total : 0} className="h-1.5" aria-label={t.progressoSprint} />
          </div>
        ) : <span className="flex-1 text-sm text-muted-foreground">{t.semSprint}</span>}
        {criandoSprint ? (
          <form onSubmit={abrirSprint} className="flex gap-2">
            <Input autoFocus value={nomeSprint} onChange={(e) => setNomeSprint(e.target.value)} placeholder={t.nomeSprint} className="h-8 w-40" maxLength={80} />
            <Button size="sm" type="submit" disabled={eq.criarSprint.isPending}>{t.abrir}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setCriandoSprint(false)}>{textos.conversa.cancelar}</Button>
          </form>
        ) : <Button size="sm" variant="outline" onClick={() => setCriandoSprint(true)}>{t.novaSprint}</Button>}
      </div>

      <div role="search" aria-label={t.filtros} className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:px-6">
        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t.buscar} aria-label={t.buscar}
            className="h-8 bg-card pl-7 text-xs" />
        </div>
        <NativeSelect className="rounded-lg bg-card" value={prioridade} aria-label={t.painel.prioridade}
          onChange={(e) => setPrioridade(e.target.value as Prioridade | "")}>
          <option value="">{t.todasPrioridades}</option>
          {PRIORIDADES.map((x) => <option key={x} value={x}>{t.prioridades[x]}</option>)}
        </NativeSelect>
        {Boolean(etiquetas?.length) && (
          <NativeSelect className="rounded-lg bg-card" value={etiqueta} aria-label={t.painel.etiquetas} onChange={(e) => setEtiqueta(e.target.value)}>
            <option value="">{t.todasEtiquetas}</option>
            {etiquetas!.map((e) => <option key={e.id} value={e.nome}>{e.nome} ({e.tarefas})</option>)}
          </NativeSelect>
        )}
        {filtrando && (
          <Button variant="ghost" size="sm" onClick={() => { setBusca(""); setPrioridade(""); setEtiqueta(""); }}>
            <XIcon />{t.limparFiltros}
          </Button>
        )}
      </div>

      <div onPointerEnter={prepararPainel} onFocusCapture={prepararPainel} onTouchStart={prepararPainel}
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 md:p-6 xl:grid xl:snap-none xl:grid-cols-4">
        {STATUS.map((st) => {
          const coluna = visiveis.filter((x) => x.status === st);
          return (
            <section key={st} aria-label={t.colunas[st]}
              className="flex w-[82vw] max-w-72 min-w-0 flex-none snap-start flex-col gap-2 rounded-[var(--raio-xl)] bg-superficie/70 p-2 md:w-64 xl:w-auto xl:max-w-none">
              <header className="flex items-center gap-2 px-1 pt-1">
                <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{t.colunas[st]}</h3>
                <Badge variant="secondary" className="ml-auto">{coluna.length}</Badge>
              </header>
              {st === "a_fazer" && (
                <form onSubmit={criar} className="flex gap-1.5">
                  <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t.novaTarefa} aria-label={t.novaTarefa}
                    className="h-9 bg-card" maxLength={200} />
                  <Button size="icon" type="submit" aria-label={t.criar} disabled={!titulo.trim() || eq.criarTarefa.isPending}><PlusIcon /></Button>
                </form>
              )}
              <div className="grid min-h-0 gap-2 overflow-x-hidden overflow-y-auto">
                {isPending && st === "a_fazer" && <Skeleton className="h-20" />}
                {coluna.map((x) => (
                  <Cartao key={x.id} tarefa={x} eu={eu} admin={admin}
                    mover={(s) => eq.alterarTarefa.mutate({ id: x.id, status: s })}
                    pegar={() => eq.alterarTarefa.mutate({ id: x.id, responsavel: eu, status: x.status === "a_fazer" ? "fazendo" : x.status })}
                    apagar={() => eq.apagarTarefa.mutate(x.id)} abrir={() => setAberta(x.id)} />
                ))}
                {!isPending && coluna.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t.vazia}</p>}
              </div>
            </section>
          );
        })}
      </div>
      {/* Montado antes do clique e mantido (só alterna `open`): montar o diálogo no próprio clique
          fazia ele ler esse clique como "fora" e fechar na hora. */}
      {(painelPronto || aberta !== null) && (
        <Suspense fallback={null}>
          <PainelTarefa id={aberta} sala={sala} membros={membros} fechar={() => setAberta(null)} />
        </Suspense>
      )}
    </div>
  );
}
