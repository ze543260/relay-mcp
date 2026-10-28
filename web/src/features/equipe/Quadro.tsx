import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { corDe, ehIa, horaDe, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { STATUS, useEquipe, useSprints, useTarefas, type Status, type Tarefa } from "./api";

const t = textos.equipe;

function Responsavel({ nome }: { nome: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar aria-hidden className={cn("size-5", !ehIa(nome) && "rounded-md after:rounded-md")}>
        <AvatarFallback className={cn("text-[8.5px] font-semibold text-white", !ehIa(nome) && "rounded-md")} style={{ background: corDe(nome) }}>
          {siglaDe(nome)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{nome}</span>
    </span>
  );
}

function Cartao({ tarefa, eu, admin, mover, pegar, apagar }: {
  tarefa: Tarefa; eu: string; admin: boolean;
  mover: (s: Status) => void; pegar: () => void; apagar: () => void;
}) {
  const i = STATUS.indexOf(tarefa.status);
  return (
    <article className="group/cartao grid min-w-0 gap-2 rounded-[var(--raio-xl)] border bg-card p-3 shadow-xs">
      <div className="flex items-start gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{tarefa.id}</span>
        <p className="min-w-0 flex-1 text-sm leading-snug font-medium [overflow-wrap:break-word] hyphens-auto">{tarefa.titulo}</p>
        {(admin || tarefa.criada_por === eu) && (
          <Button variant="ghost" size="icon-xs" aria-label={t.apagar} onClick={apagar}
            className="opacity-100 md:opacity-0 md:group-hover/cartao:opacity-100 md:focus-visible:opacity-100"><Trash2Icon /></Button>
        )}
      </div>
      {tarefa.descricao && <p className="text-xs text-muted-foreground">{tarefa.descricao}</p>}
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
export default function Quadro({ sala, eu, admin }: { sala: string; eu: string; admin: boolean }) {
  const { data: tarefas, isPending } = useTarefas(sala);
  const { data: sprints } = useSprints(sala);
  const eq = useEquipe(sala);
  const [titulo, setTitulo] = useState("");
  const [nomeSprint, setNomeSprint] = useState("");
  const [criandoSprint, setCriandoSprint] = useState(false);
  const ativa = sprints?.find((s) => s.ativa);

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

      <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 md:p-6 xl:grid xl:snap-none xl:grid-cols-4">
        {STATUS.map((st) => {
          const coluna = (tarefas ?? []).filter((x) => x.status === st);
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
                    apagar={() => eq.apagarTarefa.mutate(x.id)} />
                ))}
                {!isPending && coluna.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t.vazia}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
