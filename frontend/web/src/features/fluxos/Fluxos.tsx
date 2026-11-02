import { PlusIcon, WorkflowIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import { useFluxos, useMexerFluxo, usePedidos, type EstadoPedido, type FluxoPublicado, type PedidoFluxo } from "./api";
import { MODELO, type DocFluxo } from "./grafo";

// React Flow só carrega quando um fluxo abre.
const PainelFluxo = lazy(() => import("./PainelFluxo"));
const EditorFluxo = lazy(() => import("./Editor"));
const t = textos.fluxos;

const ABERTOS: EstadoPedido[] = ["pendente", "aceito"];

function Pedido({ p, eu, admin }: { p: PedidoFluxo; eu: string; admin: boolean }) {
  const { cancelar } = useMexerFluxo();
  const [aberto, setAberto] = useState(false);
  const podeCancelar = ABERTOS.includes(p.estado) && (p.de === eu || admin);
  return (
    <li className="rounded-[var(--raio-xl)] border bg-card p-3 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm"><span className="font-mono">#{p.id} {p.nome}@{p.versao}</span></span>
          <span className="truncate text-xs text-muted-foreground">{t.deParaQuando(p.de, p.agente, new Date(p.criado_em))}</span>
        </span>
        <Badge variant={p.estado === "concluido" ? "default" : p.estado === "falhou" || p.estado === "recusado" ? "destructive" : "outline"}>
          {t.estados[p.estado]}
        </Badge>
        {podeCancelar && (
          <Button size="icon" variant="ghost" className="size-7" aria-label={t.cancelar(p.id)} title={t.cancelar(p.id)}
            disabled={cancelar.isPending} onClick={() => cancelar.mutate(p.id)}><XIcon /></Button>
        )}
      </div>
      {(p.motivo || p.resultado || Object.keys(p.params).length > 0) && (
        <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAberto(!aberto)}>
          {aberto ? t.esconderDetalhes : t.verDetalhes}
        </button>
      )}
      {aberto && (
        <pre className="mt-1.5 max-h-60 overflow-auto rounded-[var(--raio-md)] bg-superficie p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
          {JSON.stringify({ params: p.params, motivo: p.motivo ?? undefined, resultado: p.resultado ?? undefined }, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** Aba Fluxos: catálogo da sala (publicar não aprova) e os pedidos feitos ou recebidos. */
export default function Fluxos({ sala, eu, admin }: { sala: string; eu: string; admin: boolean }) {
  const { data: fluxos, isPending } = useFluxos(sala);
  const { data: pedidos } = usePedidos(sala);
  const [aberto, setAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ doc: DocFluxo; layout: FluxoPublicado["layout"]; chave: number } | null>(null);
  const editar = (doc: DocFluxo, layout: FluxoPublicado["layout"] = null) => setEditando({ doc, layout, chave: Date.now() });
  const lista = [...(pedidos ?? [])].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <WorkflowIcon className="size-4 text-primary" aria-hidden />
        <span className="text-sm text-muted-foreground">{t.explicacao}</span>
        <Button size="sm" className="ml-auto" onClick={() => editar(MODELO)}><PlusIcon />{t.novo}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-3xl gap-6">
          <section className="grid gap-2" aria-labelledby="fluxos-catalogo">
            <h2 id="fluxos-catalogo" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t.catalogo}</h2>
            {isPending ? <><Skeleton className="h-16" /><Skeleton className="h-16" /></>
              : (fluxos ?? []).length === 0 ? (
                <div className="mx-auto mt-[6vh] max-w-96 text-center text-muted-foreground">
                  <WorkflowIcon className="mx-auto mb-3 size-8 opacity-50" aria-hidden />
                  <h3 className="mb-1.5 text-[15px] font-semibold text-foreground">{t.vazio}</h3>
                  <p className="text-sm">{t.vazioDica}</p>
                </div>
              ) : fluxos!.map((f) => (
                <button key={f.nome} type="button" onClick={() => setAberto(f.nome)}
                  className="flex items-start gap-3 rounded-[var(--raio-xl)] border bg-card p-3 text-left shadow-xs transition-colors hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring">
                  <WorkflowIcon className="mt-0.5 size-5 flex-none text-primary" aria-hidden />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-mono text-sm font-medium">{f.nome}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{f.descricao ?? t.semDescricao}</span>
                    <span className="truncate text-xs text-muted-foreground">{t.linhaCatalogo(f.publicado_por, f.pior_caso, f.sha256)}</span>
                  </span>
                  <Badge variant="outline">v{f.versao}</Badge>
                </button>
              ))}
          </section>
          <section className="grid gap-2" aria-labelledby="fluxos-pedidos">
            <h2 id="fluxos-pedidos" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t.pedidos}</h2>
            {lista.length === 0 ? <p className="text-sm text-muted-foreground">{t.semPedidos}</p> : (
              <ul className={cn("grid gap-2")}>{lista.map((p) => <Pedido key={p.id} p={p} eu={eu} admin={admin} />)}</ul>
            )}
          </section>
        </div>
      </div>
      <Suspense fallback={null}>
        <PainelFluxo sala={sala} nome={aberto} fechar={() => setAberto(null)}
          aoEditar={(doc, layout) => { setAberto(null); editar(doc, layout); }} />
      </Suspense>
      {editando && (
        <Suspense fallback={null}>
          <EditorFluxo key={editando.chave} sala={sala} inicial={editando.doc} layoutInicial={editando.layout} aberto
            fechar={() => setEditando(null)} aoPublicar={(nome) => setAberto(nome)} />
        </Suspense>
      )}
    </div>
  );
}
