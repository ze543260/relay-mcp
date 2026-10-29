import { ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import Markdown from "@/shared/markdown/Markdown";
import {
  ESTIMATIVAS, PRIORIDADES, STATUS, useEquipe, useTarefa,
  type EdicaoTarefa, type Prioridade, type Status, type TarefaCompleta,
} from "./api";
import { ChipEtiqueta, IconePrioridade } from "./pecas";
import { quandoMudou } from "./prazo";

const t = textos.equipe;
const p = t.painel;

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {rotulo}
      {children}
    </label>
  );
}

function Detalhes({ tarefa, alterar, membros }: {
  tarefa: TarefaCompleta; alterar: (d: EdicaoTarefa) => void; membros: string[];
}) {
  const prazo = tarefa.prazo ? tarefa.prazo.slice(0, 10) : "";
  return (
    <div className="grid grid-cols-2 gap-3">
      <Campo rotulo={p.status}>
        <NativeSelect className="w-full" value={tarefa.status} onChange={(e) => alterar({ status: e.target.value as Status })}>
          {STATUS.map((s) => <option key={s} value={s}>{t.colunas[s]}</option>)}
        </NativeSelect>
      </Campo>
      <Campo rotulo={p.prioridade}>
        <NativeSelect className="w-full" value={tarefa.prioridade} onChange={(e) => alterar({ prioridade: e.target.value as Prioridade })}>
          {PRIORIDADES.map((x) => <option key={x} value={x}>{t.prioridades[x]}</option>)}
        </NativeSelect>
      </Campo>
      <Campo rotulo={p.estimativa}>
        <NativeSelect className="w-full" value={tarefa.estimativa ?? ""}
          onChange={(e) => alterar({ estimativa: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t.semEstimativa}</option>
          {ESTIMATIVAS.map((n) => <option key={n} value={n}>{t.pontos(n)}</option>)}
        </NativeSelect>
      </Campo>
      <Campo rotulo={p.prazo}>
        <Input type="date" className="h-8" value={prazo} onChange={(e) => alterar({ prazo: e.target.value || null })} />
      </Campo>
      <Campo rotulo={p.responsavel}>
        <NativeSelect className="w-full" value={tarefa.responsavel ?? ""} onChange={(e) => alterar({ responsavel: e.target.value || null })}>
          <option value="">{p.ninguem}</option>
          {[...new Set([...(tarefa.responsavel ? [tarefa.responsavel] : []), ...membros])].map((n) => <option key={n} value={n}>{n}</option>)}
        </NativeSelect>
      </Campo>
    </div>
  );
}

function Etiquetas({ tarefa, alterar }: { tarefa: TarefaCompleta; alterar: (d: EdicaoTarefa) => void }) {
  const [nova, setNova] = useState("");
  const nomes = tarefa.etiquetas.map((e) => e.nome);
  function adicionar(e: FormEvent) {
    e.preventDefault();
    const n = nova.trim();
    if (!n || nomes.some((x) => x.toLowerCase() === n.toLowerCase())) return setNova("");
    alterar({ etiquetas: [...nomes, n] });
    setNova("");
  }
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{p.etiquetas}</h3>
      <div className="flex flex-wrap gap-1.5">
        {tarefa.etiquetas.map((e) => (
          <ChipEtiqueta key={e.id} etiqueta={e} remover={() => alterar({ etiquetas: nomes.filter((x) => x !== e.nome) })} />
        ))}
        {tarefa.etiquetas.length < 10 && (
          <form onSubmit={adicionar}>
            <Input value={nova} onChange={(e) => setNova(e.target.value)} placeholder={p.novaEtiqueta} aria-label={p.novaEtiqueta}
              maxLength={24} className="h-6 w-32 rounded-full px-2 text-xs" />
          </form>
        )}
      </div>
    </section>
  );
}

function Descricao({ tarefa, alterar }: { tarefa: TarefaCompleta; alterar: (d: EdicaoTarefa) => void }) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{p.descricao}</h3>
        {rascunho === null && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setRascunho(tarefa.descricao ?? "")}>
            <PencilIcon />{p.editar}
          </Button>
        )}
      </div>
      {rascunho === null ? (
        tarefa.descricao
          ? <div className="text-sm [overflow-wrap:anywhere]"><Markdown texto={tarefa.descricao} /></div>
          : <p className="text-sm text-muted-foreground">{p.semDescricao}</p>
      ) : (
        <div className="grid gap-2">
          <Textarea autoFocus value={rascunho} onChange={(e) => setRascunho(e.target.value)} rows={8} maxLength={20_000}
            aria-label={p.descricao} className="font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRascunho(null)}>{textos.conversa.cancelar}</Button>
            <Button size="sm" onClick={() => { alterar({ descricao: rascunho.trim() || null }); setRascunho(null); }}>{p.salvar}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Checklist({ tarefa }: { tarefa: TarefaCompleta }) {
  const eq = useEquipe(tarefa.sala);
  const [novo, setNovo] = useState("");
  const { feitos, total } = tarefa.checklist;
  function adicionar(e: FormEvent) {
    e.preventDefault();
    const texto = novo.trim();
    if (!texto) return;
    eq.criarItem.mutate({ id: tarefa.id, texto }, { onSuccess: () => setNovo("") });
  }
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{p.checklist}</h3>
        {total > 0 && <span className="text-xs text-muted-foreground tabular-nums">{feitos}/{total}</span>}
      </div>
      {total > 0 && <Progress value={(100 * feitos) / total} className="h-1" aria-label={t.checklistResumo(feitos, total)} />}
      <ul className="grid gap-0.5">
        {tarefa.itens.map((i) => (
          <li key={i.id} className="group/item flex items-center gap-2 rounded-[var(--raio-md)] px-1 py-1 hover:bg-muted/50">
            <Checkbox checked={i.feito} aria-label={i.texto}
              onCheckedChange={(v) => eq.alterarItem.mutate({ id: tarefa.id, item: i.id, feito: Boolean(v) })} />
            <span className={cn("min-w-0 flex-1 text-sm [overflow-wrap:anywhere] transition-colors duration-[var(--mov-padrao)]", i.feito && "text-muted-foreground")}>
              {/* Risco desenhado da esquerda pra direita ao marcar. */}
              <span className={cn("box-decoration-clone bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_58%] bg-no-repeat transition-[background-size] duration-[var(--mov-padrao)] ease-[var(--mov-curva)]",
                i.feito ? "bg-[length:100%_1px]" : "bg-[length:0%_1px]")}>{i.texto}</span>
            </span>
            <Button variant="ghost" size="icon-xs" aria-label={p.apagarItem(i.texto)}
              className="opacity-100 md:opacity-0 md:group-hover/item:opacity-100 md:focus-visible:opacity-100"
              onClick={() => eq.apagarItem.mutate({ id: tarefa.id, item: i.id })}><Trash2Icon /></Button>
          </li>
        ))}
      </ul>
      {total < 50 && (
        <form onSubmit={adicionar} className="flex gap-1.5">
          <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={p.novoItem} aria-label={p.novoItem}
            maxLength={300} className="h-8" />
          <Button size="icon-sm" type="submit" aria-label={p.adicionarItem} disabled={!novo.trim() || eq.criarItem.isPending}><PlusIcon /></Button>
        </form>
      )}
    </section>
  );
}

function Historico({ tarefa }: { tarefa: TarefaCompleta }) {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="grid gap-2">
      <button type="button" onClick={() => setAberto((x) => !x)} aria-expanded={aberto}
        className="flex items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className={cn("size-3.5 transition-transform", !aberto && "-rotate-90")} />
        {p.atividade(tarefa.atividade.length)}
      </button>
      {aberto && (
        <ol className="grid gap-1.5 border-l pl-3">
          {tarefa.atividade.map((a, n) => (
            <li key={n} className="text-xs">
              <b className="font-medium">{a.de}</b> <span className="text-muted-foreground">{p.campos[a.campo] ?? a.campo}</span>
              {(a.antes || a.depois) && a.campo !== "criada" && (
                <span className="text-muted-foreground"> · {a.antes ?? "∅"} → {a.depois ?? "∅"}</span>
              )}
              <time dateTime={a.quando} className="block text-[11px] text-muted-foreground tabular-nums">{quandoMudou(a.quando)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Painel lateral da tarefa (tela cheia no celular): campos, etiquetas, descrição em Markdown, checklist e histórico. */
export default function PainelTarefa({ id, sala, membros, fechar }: {
  id: number | null; sala: string; membros: string[]; fechar: () => void;
}) {
  const { data: tarefa, isPending } = useTarefa(id);
  const eq = useEquipe(sala);
  const [titulo, setTitulo] = useState<string | null>(null);
  const alterar = (d: EdicaoTarefa) => { if (tarefa) eq.alterarTarefa.mutate({ id: tarefa.id, ...d }); };

  function salvarTitulo() {
    const novo = titulo?.trim();
    if (tarefa && novo && novo !== tarefa.titulo) alterar({ titulo: novo });
    setTitulo(null);
  }

  return (
    <Sheet open={id !== null} onOpenChange={(aberto) => { if (!aberto) { setTitulo(null); fechar(); } }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {isPending || !tarefa ? (
          <div className="grid gap-3 p-4"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
        ) : (
          <>
            <SheetHeader className="gap-1 border-b pr-12">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">#{tarefa.id}</span>
                <IconePrioridade prioridade={tarefa.prioridade} />
              </div>
              <SheetTitle className="sr-only">{tarefa.titulo}</SheetTitle>
              <Input value={titulo ?? tarefa.titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={salvarTitulo}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setTitulo(null); }}
                maxLength={200} aria-label={p.titulo}
                className="h-auto border-transparent px-1 text-base font-semibold shadow-none hover:border-input dark:bg-transparent" />
              <SheetDescription className="text-xs">
                {p.criadaPor(tarefa.criada_por, new Date(tarefa.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 p-4">
              <Detalhes tarefa={tarefa} alterar={alterar} membros={membros} />
              <Etiquetas tarefa={tarefa} alterar={alterar} />
              <Descricao key={tarefa.id} tarefa={tarefa} alterar={alterar} />
              <Checklist tarefa={tarefa} />
              <Historico tarefa={tarefa} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
