import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpToLineIcon, WorkflowIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tarefa } from "@/features/equipe/api";
import { cn } from "@/lib/utils";
import { api } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import { avisar } from "@/shared/lib/avisar";
import { textos } from "@/shared/lib/textos";

const t = textos.perfil;
const te = textos.equipe;

/** Item da pilha: a tarefa com a posição e, se acompanha um pedido de fluxo, o estado dele. */
export interface ItemPilha extends Tarefa {
  posicao: number;
  pilha: number | null;
  pedido: { id: number; de: string; nome: string; versao: number; estado: string; expira_em: string; motivo: string | null } | null;
}

export const usePilha = (agente: string | null) => useQuery({
  queryKey: ["pilha", agente],
  queryFn: ({ signal }) => api<{ agente: string; itens: ItemPilha[] }>(`/pilha?${new URLSearchParams({ agente: agente! })}`, { sinal: signal }),
  enabled: agente !== null,
});

type Posicao = { topo: true } | { antes_de: number } | { depois_de: number };

function useMover(agente: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tarefa, ...pos }: { tarefa: number } & Posicao) =>
      api<{ agente: string; itens: ItemPilha[] }>("/pilha/mover", { metodo: "POST", corpo: { tarefa, ...pos } }),
    onSuccess: (r) => {
      qc.setQueryData(["pilha", agente], r);
      void qc.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: (e) => avisar("erro", traduzirErro(e).mensagem),
  });
}

/**
 * Pilha do agente (docs/PLANO-PILHA.md): o que está com ele, em todas as salas, na ordem em que vai fazer.
 * Pedidos de fluxo entram como tarefa e mostram o estado do pedido. Só o dono, humanos e o admin reordenam;
 * o servidor recusa o resto e o aviso diz por quê.
 */
export function Pilha({ agente, sala }: { agente: string; sala: string }) {
  const { data, isPending } = usePilha(agente);
  const mover = useMover(agente);
  if (isPending) return <div className="grid gap-1.5"><Skeleton className="h-11" /><Skeleton className="h-11" /></div>;
  const itens = data?.itens ?? [];
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{t.pilhaVazia}</p>;
  return (
    <ol className="grid gap-1.5" aria-label={t.pilhaDe(agente)}>
      {itens.map((x, i) => {
        const anterior = itens[i - 1], seguinte = itens[i + 1];
        return (
          <li key={x.id} className={cn("group/item flex items-start gap-2 rounded-[var(--raio-lg)] border bg-card px-2.5 py-2",
            x.status === "fazendo" && "border-primary/50 bg-primary/5")}>
            <span className="w-5 flex-none pt-0.5 text-right font-mono text-xs text-muted-foreground tabular-nums">{x.posicao}</span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                {x.pedido && <WorkflowIcon className="size-3.5 flex-none text-primary" aria-label={t.pedidoFluxo} />}
                <span className="truncate">{x.titulo}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">#{x.id}</span>
                {x.sala !== sala && <span>· #{x.sala}</span>}
                <span>· {te.colunas[x.status]}</span>
                {x.prioridade !== "nenhuma" && <span>· {te.prioridades[x.prioridade]}</span>}
                {x.pedido && <Badge variant="outline" className="h-4 px-1 text-[10px]">{t.estadoPedido(x.pedido.id, x.pedido.estado)}</Badge>}
              </span>
            </span>
            {/* Reordenar: aparece ao passar o mouse ou com foco (sempre no toque). */}
            <span className="flex flex-none gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/item:opacity-100 md:group-hover/item:opacity-100">
              <Button size="icon" variant="ghost" className="size-7" aria-label={t.paraTopo(x.id)} title={t.paraTopo(x.id)}
                disabled={i === 0 || mover.isPending} onClick={() => mover.mutate({ tarefa: x.id, topo: true })}><ArrowUpToLineIcon /></Button>
              <Button size="icon" variant="ghost" className="size-7" aria-label={t.subir(x.id)} title={t.subir(x.id)}
                disabled={!anterior || mover.isPending} onClick={() => anterior && mover.mutate({ tarefa: x.id, antes_de: anterior.id })}><ArrowUpIcon /></Button>
              <Button size="icon" variant="ghost" className="size-7" aria-label={t.descer(x.id)} title={t.descer(x.id)}
                disabled={!seguinte || mover.isPending} onClick={() => seguinte && mover.mutate({ tarefa: x.id, depois_de: seguinte.id })}><ArrowDownIcon /></Button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
