import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTema } from "@/shared/lib/tema";
import { chaveSeta, LARGURA_NO, portasDe, resumoNo, ROTULOS, rotuloPorta, setasDe, tipoDe, type Caminho, type Layout, type No } from "./grafo";

type DadosNo = { no: No; erro: boolean; noCaminho: boolean; selecionado: boolean; editavel: boolean };

// Cores por família de nó, nos tokens do DS.
const COR: Record<string, string> = {
  passo: "border-l-primary", desvio: "border-l-[var(--agente-3)]", laco: "border-l-[var(--agente-5)]",
  parada: "border-l-[var(--agente-1)]", fim: "border-l-muted-foreground",
};
const familia = (no: No) => {
  const t = tipoDe(no);
  if (t === "if" || t === "switch") return "desvio";
  if (t === "for_each" || t === "repeat_until") return "laco";
  if (t === "approval" || t === "fail") return "parada";
  if (t === "end") return "fim";
  return "passo";
};

function CartaoNo({ data }: NodeProps<Node<DadosNo>>) {
  const { no, erro, noCaminho, selecionado, editavel } = data;
  const tipo = tipoDe(no);
  const portas = portasDe(no);
  const resumo = resumoNo(no);
  return (
    <div style={{ width: LARGURA_NO }}
      className={cn("rounded-[var(--raio-lg)] border border-l-4 bg-card px-3 py-2 text-left shadow-xs transition-[box-shadow,opacity]",
        COR[familia(no)], erro && "border-destructive ring-2 ring-destructive/30", selecionado && "ring-2 ring-ring",
        noCaminho && "shadow-[0_0_0_3px_var(--primary)]")}>
      <Handle type="target" position={Position.Top} isConnectable={editavel} className="!size-2.5 !border-2 !border-card !bg-muted-foreground" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{tipo ? ROTULOS[tipo] : "?"}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{no.id}</span>
      </div>
      {typeof no.label === "string" && <div className="truncate text-sm font-medium">{no.label}</div>}
      {resumo && <div className="line-clamp-2 font-mono text-xs [overflow-wrap:anywhere]">{resumo}</div>}
      {portas.length > 1 && (
        <div className="mt-1.5 flex justify-around gap-1 text-[10px] text-muted-foreground">
          {portas.map((p) => <span key={p} className="truncate">{rotuloPorta(p)}</span>)}
        </div>
      )}
      {portas.map((p, i) => (
        <Handle key={p} id={p} type="source" position={Position.Bottom} isConnectable={editavel}
          style={{ left: `${((i + 1) / (portas.length + 1)) * 100}%` }}
          className={cn("!size-2.5 !border-2 !border-card", p === "else" || p === "on_timeout" ? "!bg-destructive" : p === "body" ? "!bg-[var(--agente-5)]" : "!bg-primary")} />
      ))}
    </div>
  );
}

const TIPOS = { no: CartaoNo };

export interface PropsFluxograma {
  nos: No[];
  layout: Layout;
  editavel?: boolean;
  caminho?: Caminho | null;
  comErro?: Set<string>;
  selecionado?: string | null;
  aoSelecionar?: (id: string | null) => void;
  aoMover?: (id: string, pos: [number, number]) => void;
  aoLigar?: (de: string, porta: string, para: string) => void;
  aoDesligar?: (de: string, porta: string) => void;
  aoApagar?: (id: string) => void;
  className?: string;
}

/** O fluxo desenhado. Só leitura por padrão; com `editavel`, arrasta, liga portas e apaga com Delete. */
export function Fluxograma({ nos, layout, editavel = false, caminho, comErro, selecionado, aoSelecionar, aoMover, aoLigar, aoDesligar, aoApagar, className }: PropsFluxograma) {
  const { resolvido } = useTema();
  const noCaminho = useMemo(() => new Set(caminho?.nos ?? []), [caminho]);
  const nodes = useMemo<Node<DadosNo>[]>(() => nos.map((no) => ({
    id: no.id, type: "no", position: { x: layout[no.id]?.[0] ?? 0, y: layout[no.id]?.[1] ?? 0 },
    data: { no, erro: comErro?.has(no.id) ?? false, noCaminho: noCaminho.has(no.id), selecionado: selecionado === no.id, editavel },
    selected: selecionado === no.id, draggable: editavel,
    style: caminho && !noCaminho.has(no.id) ? { opacity: 0.4 } : undefined,
  })), [nos, layout, comErro, noCaminho, selecionado, editavel, caminho]);
  const edges = useMemo<Edge[]>(() => setasDe(nos).map((s) => {
    const acesa = caminho?.setas.has(chaveSeta(s)) ?? false;
    const ruim = s.porta === "else" || s.porta === "on_timeout";
    const cor = acesa ? "var(--primary)" : ruim ? "var(--destructive)" : "var(--muted-foreground)";
    return {
      id: `${s.de}:${s.porta}`, source: s.de, sourceHandle: s.porta, target: s.para, label: rotuloPorta(s.porta) || undefined,
      animated: acesa, deletable: editavel, markerEnd: { type: MarkerType.ArrowClosed, color: cor },
      style: { stroke: cor, strokeWidth: acesa ? 2.5 : 1.5, strokeDasharray: s.porta === "body" ? "5 4" : undefined, opacity: caminho && !acesa ? 0.35 : 1 },
      labelStyle: { fontSize: 11, fill: "var(--muted-foreground)" },
      labelBgStyle: { fill: "var(--card)" },
    };
  }), [nos, caminho, editavel]);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={TIPOS} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }} minZoom={0.2}
        colorMode={resolvido === "escuro" ? "dark" : "light"} proOptions={{ hideAttribution: true }}
        nodesDraggable={editavel} nodesConnectable={editavel} elementsSelectable deleteKeyCode={editavel ? ["Delete", "Backspace"] : null}
        onNodeClick={(_, n) => aoSelecionar?.(n.id)} onPaneClick={() => aoSelecionar?.(null)}
        onNodeDragStop={(_, n) => aoMover?.(n.id, [Math.round(n.position.x), Math.round(n.position.y)])}
        onConnect={(c: Connection) => { if (c.sourceHandle && c.target !== c.source) aoLigar?.(c.source, c.sourceHandle, c.target); }}
        onEdgesDelete={(es) => es.forEach((e) => aoDesligar?.(e.source, e.sourceHandle ?? "next"))}
        onNodesDelete={(ns) => ns.forEach((n) => aoApagar?.(n.id))}>
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden md:!block" />
      </ReactFlow>
    </div>
  );
}
