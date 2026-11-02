import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { corDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { ehArquivo, type Fato } from "./api";

const t = textos.memoria;

interface NoG extends SimulationNodeDatum {
  id: string;        // chave sem diferenciar maiúsculas
  rotulo: string;
  grau: number;
  arquivo: boolean;
}
interface ArestaG extends SimulationLinkDatum<NoG> {
  fato: Fato;
  /** Índice entre arestas do mesmo par, para curvar as paralelas. */
  curva: number;
}

const chave = (s: string) => s.trim().toLowerCase();
const raio = (grau: number) => 5 + Math.min(14, Math.sqrt(grau) * 3.5);

/** Fatos viram grafo: sujeitos e objetos são nós; cada fato é uma aresta rotulada com o predicado. */
function montar(fatos: Fato[]): { nos: NoG[]; arestas: ArestaG[] } {
  const nos = new Map<string, NoG>();
  const no = (nome: string) => {
    const k = chave(nome);
    const n = nos.get(k) ?? { id: k, rotulo: nome, grau: 0, arquivo: ehArquivo(nome) };
    n.grau++;
    nos.set(k, n);
    return k;
  };
  const pares = new Map<string, number>();
  const arestas = fatos.map((fato) => {
    const s = no(fato.sujeito), o = no(fato.objeto);
    const par = [s, o].sort().join("\u0000");
    const n = pares.get(par) ?? 0;
    pares.set(par, n + 1);
    return { source: s, target: o, fato, curva: n };
  });
  return { nos: [...nos.values()], arestas };
}

/** Folha de papel centrada em 0,0 com meia-altura `r` e a ponta superior direita dobrada. */
const folha = (r: number) => {
  const w = r * 0.8, d = r * 0.45;
  return `M${-w},${-r} H${w - d} L${w},${-r + d} V${r} H${-w} Z M${w - d},${-r} V${-r + d} H${w}`;
};
const linhas = (r: number) => {
  const w = r * 0.45;
  return [-0.15, 0.2, 0.55].map((f) => `M${-w},${r * f} H${w}`).join(" ");
};

const caminhoAresta = (a: ArestaG) => {
  const s = a.source as NoG, o = a.target as NoG;
  const x1 = s.x ?? 0, y1 = s.y ?? 0, x2 = o.x ?? 0, y2 = o.y ?? 0;
  if (s === o) return `M${x1},${y1} c 30,-40 50,0 0,${raio(s.grau) + 2}`; // fato de um nó com ele mesmo
  if (!a.curva) return `M${x1},${y1} L${x2},${y2}`;
  // Paralelas: curva alternando de lado.
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
  const k = Math.ceil(a.curva / 2) * 26 * (a.curva % 2 ? 1 : -1);
  return `M${x1},${y1} Q${mx - (dy / d) * k},${my + (dx / d) * k} ${x2},${y2}`;
};

/**
 * Visão em grafo da memória (estilo Obsidian): layout em força com d3-force, arrastar nós, zoom e pan,
 * vizinhança acesa ao passar o mouse e fatos do nó no painel ao clicar.
 */
export default function GrafoMemoria({ fatos, selecionado, aoSelecionar }: {
  fatos: Fato[]; selecionado: string | null; aoSelecionar: (rotulo: string | null) => void;
}) {
  const { nos, arestas } = useMemo(() => montar(fatos), [fatos]);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<NoG, ArestaG> | null>(null);
  const [, setQuadro] = useState(0); // cada tick redesenha
  const [vista, setVista] = useState({ x: 0, y: 0, k: 1 });
  const [foco, setFoco] = useState<string | null>(null);
  const arrasto = useRef<{ tipo: "no"; no: NoG; moveu: boolean } | { tipo: "fundo"; x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const sim = forceSimulation<NoG, ArestaG>(nos)
      .force("link", forceLink<NoG, ArestaG>(arestas).id((n) => n.id).distance(90).strength(0.6))
      .force("carga", forceManyBody().strength(-260))
      .force("centro", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.04))
      .force("colisao", forceCollide<NoG>((n) => raio(n.grau) + 14))
      .on("tick", () => setQuadro((q) => q + 1));
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { sim.stop(); sim.tick(300); requestAnimationFrame(() => setQuadro((q) => q + 1)); }
    simRef.current = sim;
    return () => { sim.stop(); };
  }, [nos, arestas]);

  // Vizinhos de quem está em foco (hover) ou selecionado.
  const ativo = foco ?? (selecionado ? chave(selecionado) : null);
  const vizinhos = useMemo(() => {
    if (!ativo) return null;
    const v = new Set([ativo]);
    for (const a of arestas) {
      const s = (a.source as NoG).id ?? a.source, o = (a.target as NoG).id ?? a.target;
      if (s === ativo) v.add(String(o));
      if (o === ativo) v.add(String(s));
    }
    return v;
  }, [ativo, arestas]);

  const paraMundo = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - r.width / 2 - vista.x) / vista.k, y: (e.clientY - r.top - r.height / 2 - vista.y) / vista.k };
  };
  const zoom = (fator: number) => setVista((v) => ({ ...v, k: Math.min(4, Math.max(0.2, v.k * fator)) }));

  // Roda do mouse: zoom em volta do cursor. Precisa ser não-passivo para impedir a rolagem da página.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
      setVista((v) => {
        const k = Math.min(4, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", aoRolar, { passive: false });
    return () => svg.removeEventListener("wheel", aoRolar);
  }, []);

  const descerNo = (e: PE, n: NoG) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    arrasto.current = { tipo: "no", no: n, moveu: false };
    n.fx = n.x; n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  };
  const mover = (e: PE) => {
    const a = arrasto.current;
    if (!a) return;
    if (a.tipo === "no") {
      const p = paraMundo(e);
      a.no.fx = p.x; a.no.fy = p.y; a.moveu = true;
    } else setVista((v) => ({ ...v, x: a.vx + e.clientX - a.x, y: a.vy + e.clientY - a.y }));
  };
  const soltar = () => {
    const a = arrasto.current;
    arrasto.current = null;
    if (a?.tipo !== "no") return;
    a.no.fx = null; a.no.fy = null;
    simRef.current?.alphaTarget(0);
    if (!a.moveu) aoSelecionar(chave(selecionado ?? "") === a.no.id ? null : a.no.rotulo);
  };

  const apagado = (id: string) => vizinhos !== null && !vizinhos.has(id);
  const mostrarRotulo = (n: NoG) => vista.k > 0.7 || n.grau > 2 || vizinhos?.has(n.id);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <svg ref={svgRef} role="img" aria-label={t.grafoRotulo(nos.length, arestas.length)}
        className="size-full touch-none select-none [cursor:grab] active:[cursor:grabbing]"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); arrasto.current = { tipo: "fundo", x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y }; }}
        onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        onClick={(e) => { if (e.target === svgRef.current) aoSelecionar(null); }}>
        <defs>
          <marker id="seta-memoria" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        <g style={{ transform: `translate(50%, 50%) translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}>
          {arestas.map((a, i) => {
            // Antes do forceLink rodar, source/target ainda são ids.
            if (typeof a.source !== "object" || typeof a.target !== "object") return null;
            const s = a.source, o = a.target;
            const antigo = a.fato.estado !== "vigente";
            const aceso = vizinhos !== null && (vizinhos.has(s.id) && vizinhos.has(o.id)) && (s.id === ativo || o.id === ativo);
            // Encurta a linha até a borda do nó de destino para a seta aparecer.
            const dx = (o.x ?? 0) - (s.x ?? 0), dy = (o.y ?? 0) - (s.y ?? 0), d = Math.hypot(dx, dy) || 1, r = raio(o.grau) + 3;
            const alvo = { ...a, target: { ...o, x: (o.x ?? 0) - (dx / d) * r, y: (o.y ?? 0) - (dy / d) * r } } as ArestaG;
            return (
              <g key={a.fato.id} opacity={vizinhos && !aceso ? 0.12 : antigo ? 0.45 : 0.85}>
                <path id={`aresta-${i}`} d={caminhoAresta(a.curva ? a : alvo)} fill="none"
                  stroke={aceso ? "var(--primary)" : "var(--muted-foreground)"} strokeWidth={aceso ? 1.6 : 1}
                  strokeDasharray={antigo ? "4 3" : undefined} markerEnd="url(#seta-memoria)">
                  <title>{`${a.fato.sujeito} ${a.fato.predicado} ${a.fato.objeto}`}</title>
                </path>
                {(aceso || vista.k > 1.3) && (
                  <text fontSize={10} fill="var(--muted-foreground)" dy={-3}>
                    <textPath href={`#aresta-${i}`} startOffset="50%" textAnchor="middle">{a.fato.predicado}</textPath>
                  </text>
                )}
              </g>
            );
          })}
          {nos.map((n) => {
            const sel = selecionado !== null && chave(selecionado) === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} opacity={apagado(n.id) ? 0.18 : 1}
                className="cursor-pointer" role="button" tabIndex={0} aria-label={t.abrirNo(n.rotulo, n.grau)} aria-pressed={sel}
                onPointerDown={(e) => descerNo(e, n)} onPointerEnter={() => setFoco(n.id)} onPointerLeave={() => setFoco(null)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoSelecionar(sel ? null : n.rotulo); } }}>
                {n.arquivo ? (
                  // Arquivo: folha com a ponta dobrada, para separar de pessoas e conceitos.
                  <g>
                    <path d={folha(raio(n.grau) + 2)} fill="var(--card)" stroke={sel ? "var(--foreground)" : "var(--primary)"} strokeWidth={sel ? 2.5 : 1.5} strokeLinejoin="round" />
                    <path d={linhas(raio(n.grau) + 2)} stroke="var(--primary)" strokeWidth={1.2} strokeLinecap="round" />
                  </g>
                ) : (
                  <circle r={raio(n.grau)} fill={corDe(n.id)} stroke={sel ? "var(--foreground)" : "var(--background)"} strokeWidth={sel ? 2.5 : 1.5} />
                )}
                {mostrarRotulo(n) && (
                  <text y={raio(n.grau) + 12} textAnchor="middle" fontSize={11}
                    className={cn("fill-foreground [paint-order:stroke] [stroke:var(--background)] [stroke-width:3px]", sel && "font-semibold")}>
                    {n.rotulo.length > 28 ? `${n.rotulo.slice(0, 27)}…` : n.rotulo}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-[var(--raio-lg)] border bg-card p-1 shadow-xs">
        <Button size="icon" variant="ghost" className="size-7" aria-label={t.aproximar} onClick={() => zoom(1.25)}><PlusIcon /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t.afastar} onClick={() => zoom(0.8)}><MinusIcon /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t.centralizar}
          onClick={() => { setVista({ x: 0, y: 0, k: 1 }); simRef.current?.alpha(0.5).restart(); }}><LocateFixedIcon /></Button>
      </div>
    </div>
  );
}
