import { CopyIcon, PencilIcon, SendIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentes } from "@/features/agentes/useAgentes";
import { avisar } from "@/shared/lib/avisar";
import { textos } from "@/shared/lib/textos";
import { useFluxo, useMexerFluxo, type FluxoPublicado } from "./api";
import { Fluxograma } from "./Fluxograma";
import { nosDe, organizar, type DocFluxo, type Valor } from "./grafo";

const t = textos.fluxos;
type Param = Record<string, Valor>;
type ValorParam = string | number | boolean | string[];

/** Formulário do pedido: um campo por parâmetro declarado (nunca texto livre fora do que o fluxo aceita). */
function Pedir({ sala, fluxo, doc }: { sala: string; fluxo: FluxoPublicado; doc: DocFluxo }) {
  const { data: agentes } = useAgentes();
  const ias = (agentes ?? []).filter((a) => a.tipo === "ia");
  const [agente, setAgente] = useState("");
  const [valores, setValores] = useState<Record<string, ValorParam>>({});
  const [prazo, setPrazo] = useState(30);
  const { pedir } = useMexerFluxo();
  const params = Object.entries(doc.params ?? {}) as [string, Param][];

  const campo = (nome: string, p: Param) => {
    const v = valores[nome];
    const mudar = (x: ValorParam) => setValores((vs) => ({ ...vs, [nome]: x }));
    if (p.type === "boolean")
      return <input id={`p-${nome}`} type="checkbox" checked={v === true} onChange={(e) => mudar(e.target.checked)} />;
    if (p.type === "integer")
      return <Input id={`p-${nome}`} type="number" className="h-8" min={Number(p.min ?? 0)} max={p.max === undefined ? undefined : Number(p.max)}
        value={typeof v === "number" ? v : ""} onChange={(e) => mudar(Number(e.target.value))} />;
    if (p.type === "choice" && Array.isArray(p.from))
      return (
        <NativeSelect id={`p-${nome}`} className="h-8" value={typeof v === "string" ? v : ""} onChange={(e) => mudar(e.target.value)}>
          <option value="">—</option>
          {p.from.map((o) => <option key={String(o)}>{String(o)}</option>)}
        </NativeSelect>
      );
    if (p.type === "list" && Array.isArray(p.from)) {
      const marcados = Array.isArray(v) ? v : [];
      return (
        <div className="flex flex-wrap gap-3">
          {p.from.map((o) => (
            <label key={String(o)} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={marcados.includes(String(o))}
                onChange={(e) => mudar(e.target.checked ? [...marcados, String(o)] : marcados.filter((x) => x !== String(o)))} />{String(o)}
            </label>
          ))}
        </div>
      );
    }
    // `approved_repos`: a lista é local do dono; o pedido manda o nome e o executor confere.
    return <Input id={`p-${nome}`} className="h-8 font-mono" placeholder={t.repoDoDono} value={typeof v === "string" ? v : ""} onChange={(e) => mudar(e.target.value)} />;
  };

  return (
    <form className="grid gap-3 rounded-[var(--raio-lg)] border bg-superficie p-3"
      onSubmit={(e) => {
        e.preventDefault();
        pedir.mutate({ sala, agente, nome: fluxo.nome, versao: fluxo.versao, params: valores, expect_sha256: fluxo.sha256, prazo_s: prazo * 60 },
          { onSuccess: (p) => { avisar("sucesso", t.pedidoFeito(p.id, agente)); setValores({}); } });
      }}>
      <span className="text-sm font-semibold">{t.pedirTitulo}</span>
      <p className="text-xs text-muted-foreground">{t.pedirDica}</p>
      <div className="grid gap-1">
        <Label htmlFor="p-agente" className="text-xs">{t.agente}</Label>
        <NativeSelect id="p-agente" className="h-8" value={agente} onChange={(e) => setAgente(e.target.value)} required>
          <option value="">—</option>
          {ias.map((a) => <option key={a.nome} value={a.nome}>{a.apelido ?? a.nome}{a.online ? "" : ` (${t.offline})`}</option>)}
        </NativeSelect>
      </div>
      {params.map(([nome, p]) => (
        <div key={nome} className="grid gap-1">
          <Label htmlFor={`p-${nome}`} className="text-xs">{typeof p.label === "string" ? p.label : nome} <span className="font-mono text-muted-foreground">({String(p.type)})</span></Label>
          {campo(nome, p)}
        </div>
      ))}
      <div className="grid gap-1">
        <Label htmlFor="p-prazo" className="text-xs">{t.prazo}</Label>
        <Input id="p-prazo" type="number" className="h-8 w-28" min={1} max={120} value={prazo} onChange={(e) => setPrazo(Number(e.target.value))} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" type="submit" disabled={!agente || pedir.isPending}><SendIcon />{t.pedir}</Button>
      </div>
    </form>
  );
}

/** Painel de um fluxo do catálogo: fluxograma, versões, hash, JSON canônico e o pedido. */
export default function PainelFluxo({ sala, nome, fechar, aoEditar }: {
  sala: string; nome: string | null; fechar: () => void; aoEditar: (doc: DocFluxo, layout: FluxoPublicado["layout"]) => void;
}) {
  const [versao, setVersao] = useState<number | undefined>(undefined);
  const [aba, setAba] = useState<"fluxo" | "json">("fluxo");
  const { data: f, isPending } = useFluxo(sala, nome, versao);
  const doc = useMemo(() => f ? JSON.parse(f.conteudo) as DocFluxo : null, [f]);
  const nos = useMemo(() => doc ? nosDe(doc) : [], [doc]);
  const layout = useMemo(() => organizar(nos, f?.layout), [nos, f]);

  return (
    <Sheet open={nome !== null} onOpenChange={(a) => { if (!a) { setVersao(undefined); setAba("fluxo"); fechar(); } }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        {isPending || !f || !doc ? (
          <div className="grid gap-3 p-4"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-96" /></div>
        ) : (
          <>
            <SheetHeader className="gap-1.5 border-b pr-12">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">v{f.versao}</Badge>
                <span>{t.publicadoPor(f.publicado_por)}</span>
                <button type="button" className="inline-flex items-center gap-1 font-mono hover:text-foreground" title={t.copiarHash}
                  onClick={() => void navigator.clipboard?.writeText(f.sha256).then(() => avisar("sucesso", t.hashCopiado))}>
                  sha256 {f.sha256.slice(0, 12)}…<CopyIcon className="size-3" />
                </button>
              </div>
              <SheetTitle className="font-mono text-base">{f.nome}</SheetTitle>
              <SheetDescription className="text-xs">{doc.description ?? t.semDescricao}</SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <NativeSelect value={f.versao} aria-label={t.versao}
                  onChange={(e) => { const v = Number(e.target.value); setVersao(v === f.versoes[0] ? undefined : v); }}>
                  {f.versoes.map((v, i) => <option key={v} value={v}>v{v}{i === 0 ? ` (${t.atual})` : ""}</option>)}
                </NativeSelect>
                <Button size="sm" variant={aba === "fluxo" ? "secondary" : "ghost"} onClick={() => setAba("fluxo")}>{t.fluxograma}</Button>
                <Button size="sm" variant={aba === "json" ? "secondary" : "ghost"} onClick={() => setAba("json")}>{t.canonico}</Button>
                <Button size="sm" variant="outline" className="ml-auto"
                  onClick={() => aoEditar({ ...doc, version: (f.versoes[0] ?? f.versao) + 1 }, f.layout)}>
                  <PencilIcon />{t.novaVersao((f.versoes[0] ?? f.versao) + 1)}
                </Button>
              </div>
            </SheetHeader>
            <div className="grid gap-4 p-4">
              {aba === "fluxo" ? (
                <div className="flex h-[min(60dvh,560px)] flex-col overflow-hidden rounded-[var(--raio-lg)] border">
                  <Fluxograma nos={nos} layout={layout} />
                </div>
              ) : (
                <pre className="max-h-[60dvh] overflow-auto rounded-[var(--raio-lg)] border bg-superficie p-3 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {JSON.stringify(doc, null, 2)}
                </pre>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t.container}</dt><dd className="font-mono">{doc.environment.image}</dd>
                <dt className="text-muted-foreground">{t.rede}</dt><dd className="font-mono">{(doc.environment.network ?? []).join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">{t.limites}</dt>
                <dd className="font-mono">{doc.limits?.max_steps ?? 200} {t.passos}{doc.limits?.timeout ? ` · ${doc.limits.timeout}` : ""}</dd>
              </dl>
              <Pedir key={f.versao} sala={sala} fluxo={f} doc={doc} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
