import { AlertTriangleIcon, BracesIcon, CircleCheckIcon, LayoutGridIcon, PlayIcon, PlusIcon, SendIcon, Trash2Icon, WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ErroApi } from "@/shared/api/cliente";
import { avisar } from "@/shared/lib/avisar";
import { textos } from "@/shared/lib/textos";
import { useMexerFluxo } from "./api";
import { Fluxograma } from "./Fluxograma";
import {
  checar, destinoDe, idLivre, ligar, noNovo, nosDe, organizar, portasDe, ROTULOS, rotuloPorta, simular, tipoDe, TIPOS_NO,
  type DocFluxo, type Escolhas, type Layout, type No, type TipoNo, type Valor,
} from "./grafo";

const t = textos.fluxos;
const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Troca o id de um nó e todas as setas que apontavam para ele. */
function renomear(nos: No[], antigo: string, novo: string): No[] {
  return nos.map((n) => {
    let m: No = n.id === antigo ? { ...n, id: novo } : n;
    for (const porta of portasDe(m)) if (destinoDe(m, porta) === antigo) m = ligar(m, porta, novo);
    return m;
  });
}

const linhas = (v: Valor | undefined) => Array.isArray(v) ? v.map(String).join("\n") : "";
const deLinhas = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function CampoTexto({ rotulo, valor, aoMudar, mono, varias }: { rotulo: string; valor: string; aoMudar: (v: string) => void; mono?: boolean; varias?: boolean }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{rotulo}</Label>
      {varias
        ? <Textarea value={valor} rows={4} onChange={(e) => aoMudar(e.target.value)} className={cn("text-xs", mono && "font-mono")} />
        : <Input value={valor} onChange={(e) => aoMudar(e.target.value)} className={cn("h-8 text-xs", mono && "font-mono")} />}
    </div>
  );
}

/** Painel do nó: campos tipados para o comum e o JSON do nó para o resto. */
function PainelNo({ no, nos, aoMudar, aoRenomear, aoApagar }: { no: No; nos: No[]; aoMudar: (n: No) => void; aoRenomear: (novo: string) => void; aoApagar: () => void }) {
  const tipo = tipoDe(no)!;
  const [id, setId] = useState(no.id);
  const [json, setJson] = useState(() => JSON.stringify(no, null, 2));
  const [erroJson, setErroJson] = useState<string | null>(null);
  const mudar = (n: No) => { aoMudar(n); setJson(JSON.stringify(n, null, 2)); };
  const campo = (k: string, v: Valor | undefined) => {
    const n: No = { ...no };
    if (v === undefined || v === "") delete n[k]; else n[k] = v;
    mudar(n);
  };
  const obj = (no[tipo] ?? {}) as Record<string, Valor>;
  const sub = (k: string, v: Valor) => campo(tipo, { ...obj, [k]: v });
  const idOk = ID_RE.test(id) && (id === no.id || !nos.some((n) => n.id === id));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{ROTULOS[tipo]}</span>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={aoApagar}><Trash2Icon />{t.apagarNo}</Button>
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">{t.idNo}</Label>
        <Input value={id} aria-invalid={!idOk} onChange={(e) => setId(e.target.value)} className="h-8 font-mono text-xs"
          onBlur={() => { if (idOk && id !== no.id) aoRenomear(id); else setId(no.id); }} />
      </div>
      <CampoTexto rotulo={t.rotulo} valor={typeof no.label === "string" ? no.label : ""} aoMudar={(v) => campo("label", v)} />
      {tipo === "clone" && <>
        <CampoTexto rotulo={t.campos.repo} mono valor={String(no.clone ?? "")} aoMudar={(v) => campo("clone", v)} />
        <CampoTexto rotulo={t.campos.ref} mono valor={String(no.ref ?? "")} aoMudar={(v) => campo("ref", v)} />
      </>}
      {tipo === "run" && <>
        <CampoTexto rotulo={t.campos.args} mono varias valor={linhas(no.run)} aoMudar={(v) => campo("run", deLinhas(v))} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!no.outputs} onChange={(e) => campo("outputs", e.target.checked ? { exit_code: "integer" } : undefined)} />
          {t.campos.exitCode}
        </label>
      </>}
      {tipo === "serve" && <>
        <CampoTexto rotulo={t.campos.args} mono varias valor={linhas(obj.command)} aoMudar={(v) => sub("command", deLinhas(v))} />
        <CampoTexto rotulo={t.campos.porta} mono valor={String(obj.port ?? "")} aoMudar={(v) => sub("port", Number(v) || 0)} />
      </>}
      {tipo === "agent" && <CampoTexto rotulo={t.campos.prompt} varias valor={String(no.agent ?? "")} aoMudar={(v) => campo("agent", v)} />}
      {tipo === "if" && <CampoTexto rotulo={t.campos.condicao} mono valor={String(no.if ?? "")} aoMudar={(v) => campo("if", v)} />}
      {tipo === "repeat_until" && <>
        <CampoTexto rotulo={t.campos.condicao} mono valor={String(obj.until ?? "")} aoMudar={(v) => sub("until", v)} />
        <CampoTexto rotulo={t.campos.max} mono valor={String(obj.max ?? "")} aoMudar={(v) => sub("max", Number(v) || 0)} />
      </>}
      {tipo === "for_each" && <>
        <CampoTexto rotulo={t.campos.item} mono valor={String(obj.item ?? "")} aoMudar={(v) => sub("item", v)} />
        <CampoTexto rotulo={t.campos.lista} mono valor={String(obj.in ?? "")} aoMudar={(v) => sub("in", v)} />
        <CampoTexto rotulo={t.campos.max} mono valor={String(obj.max ?? "")} aoMudar={(v) => sub("max", Number(v) || 0)} />
      </>}
      {tipo === "switch" && <>
        <CampoTexto rotulo={t.campos.saida} mono valor={String(no.switch ?? "")} aoMudar={(v) => campo("switch", v)} />
        <CampoTexto rotulo={t.campos.opcoes} mono varias valor={Object.keys((no.cases as Record<string, string>) ?? {}).join("\n")}
          aoMudar={(v) => {
            const antes = (no.cases as Record<string, string>) ?? {};
            campo("cases", Object.fromEntries(deLinhas(v).map((k) => [k, antes[k] ?? ""])));
          }} />
      </>}
      {tipo === "fail" && <CampoTexto rotulo={t.campos.motivo} valor={String(no.fail ?? "")} aoMudar={(v) => campo("fail", v)} />}
      {portasDe(no).length > 0 && (
        <div className="grid gap-1.5">
          <Label className="text-xs">{t.saidas}</Label>
          {portasDe(no).map((porta) => (
            <div key={porta} className="flex items-center gap-2">
              <span className="w-20 flex-none truncate text-xs text-muted-foreground">{rotuloPorta(porta) || t.proximo}</span>
              <NativeSelect className="h-8 flex-1 text-xs" value={destinoDe(no, porta) ?? ""} aria-label={t.destino(rotuloPorta(porta) || t.proximo)}
                onChange={(e) => mudar(ligar(no, porta, e.target.value || (porta.startsWith("case:") ? "" : undefined)))}>
                <option value="">—</option>
                {nos.filter((n) => n.id !== no.id).map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
              </NativeSelect>
            </div>
          ))}
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground">{t.jsonNo}</summary>
        <Textarea value={json} rows={10} className="mt-1.5 font-mono text-xs" aria-invalid={!!erroJson}
          onChange={(e) => {
            setJson(e.target.value);
            try {
              const n = JSON.parse(e.target.value) as No;
              if (typeof n !== "object" || !n || n.id !== no.id) throw new Error(t.jsonMesmoId);
              setErroJson(null); aoMudar(n);
            } catch (err) { setErroJson(err instanceof Error ? err.message : String(err)); }
          }} />
        {erroJson && <p className="mt-1 text-xs text-destructive">{erroJson}</p>}
      </details>
    </div>
  );
}

/** Dados do fluxo (topo do arquivo): nome, versão, container, limites e parâmetros. */
function PainelFluxo({ doc, aoMudar }: { doc: DocFluxo; aoMudar: (d: DocFluxo) => void }) {
  const [params, setParams] = useState(() => JSON.stringify(doc.params ?? {}, null, 2));
  const [erroParams, setErroParams] = useState<string | null>(null);
  const amb = doc.environment ?? { image: "" };
  return (
    <div className="grid gap-3">
      <span className="text-sm font-semibold">{t.dadosFluxo}</span>
      <CampoTexto rotulo={t.campos.nome} mono valor={doc.name} aoMudar={(v) => aoMudar({ ...doc, name: v })} />
      <CampoTexto rotulo={t.campos.versao} mono valor={String(doc.version)} aoMudar={(v) => aoMudar({ ...doc, version: Number(v) || 0 })} />
      <CampoTexto rotulo={t.campos.descricao} varias valor={doc.description ?? ""} aoMudar={(v) => aoMudar({ ...doc, description: v || undefined })} />
      <CampoTexto rotulo={t.campos.imagem} mono valor={amb.image} aoMudar={(v) => aoMudar({ ...doc, environment: { ...amb, image: v } })} />
      <CampoTexto rotulo={t.campos.rede} mono varias valor={(amb.network ?? []).join("\n")}
        aoMudar={(v) => aoMudar({ ...doc, environment: { ...amb, network: deLinhas(v) } })} />
      <CampoTexto rotulo={t.campos.tempo} mono valor={doc.limits?.timeout ?? ""} aoMudar={(v) => aoMudar({ ...doc, limits: { ...doc.limits, timeout: v || undefined } })} />
      <CampoTexto rotulo={t.campos.maxPassos} mono valor={String(doc.limits?.max_steps ?? "")}
        aoMudar={(v) => aoMudar({ ...doc, limits: { ...doc.limits, max_steps: Number(v) || undefined } })} />
      <div className="grid gap-1">
        <Label className="text-xs">{t.campos.params}</Label>
        <Textarea value={params} rows={6} className="font-mono text-xs" aria-invalid={!!erroParams}
          onChange={(e) => {
            setParams(e.target.value);
            try { aoMudar({ ...doc, params: JSON.parse(e.target.value) as DocFluxo["params"] }); setErroParams(null); }
            catch (err) { setErroParams(err instanceof Error ? err.message : String(err)); }
          }} />
        {erroParams && <p className="text-xs text-destructive">{erroParams}</p>}
      </div>
    </div>
  );
}

/**
 * Editor de fluxo em tela cheia (plano, 11.5): paleta, quadro com setas, painel do nó, JSON nos dois sentidos,
 * simulação com escolhas na mão e Publicar. Publicar não aprova: quem roda aprova no próprio PC.
 */
export default function EditorFluxo({ sala, inicial, layoutInicial, aberto, fechar, aoPublicar }: {
  sala: string; inicial: DocFluxo; layoutInicial: Layout | null; aberto: boolean; fechar: () => void; aoPublicar?: (nome: string) => void;
}) {
  const [doc, setDoc] = useState<DocFluxo>(() => ({ ...inicial, nodes: nosDe(inicial), steps: undefined, layout: undefined }));
  const nos = useMemo(() => doc.nodes ?? [], [doc.nodes]);
  const [layout, setLayout] = useState<Layout>(() => organizar(nosDe(inicial), layoutInicial));
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [modo, setModo] = useState<"quadro" | "json">("quadro");
  const [texto, setTexto] = useState("");
  const [erroTexto, setErroTexto] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [escolhas, setEscolhas] = useState<Escolhas>({});
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { publicar } = useMexerFluxo();

  const problemas = useMemo(() => checar(doc), [doc]);
  const comErro = useMemo(() => new Set(problemas.flatMap((p) => p.no ? [p.no] : [])), [problemas]);
  const caminho = useMemo(() => simulando ? simular(nos, escolhas) : null, [simulando, nos, escolhas]);
  const desvios = nos.filter((n) => tipoDe(n) === "if" || tipoDe(n) === "switch");
  const no = nos.find((n) => n.id === selecionado);

  const mudarNos = (f: (nos: No[]) => No[]) => { setDoc((d) => ({ ...d, nodes: f(d.nodes ?? []) })); setErroServidor(null); };
  const adicionar = (tipo: TipoNo) => {
    const id = idLivre(nos, tipo);
    const ref = no ?? nos[nos.length - 1];
    const pos = ref && layout[ref.id] ? [layout[ref.id]![0] + 40, layout[ref.id]![1] + 110] as [number, number] : [0, 0] as [number, number];
    mudarNos((ns) => [...ns, noNovo(tipo, id)]);
    setLayout((l) => ({ ...l, [id]: pos }));
    setSelecionado(id);
  };
  const apagar = (id: string) => {
    mudarNos((ns) => ns.filter((n) => n.id !== id).map((n) => {
      let m = n;
      for (const porta of portasDe(m)) if (destinoDe(m, porta) === id) m = ligar(m, porta, porta.startsWith("case:") ? "" : undefined);
      return m;
    }));
    if (selecionado === id) setSelecionado(null);
  };
  const documento = (): DocFluxo => {
    const usados = Object.fromEntries(nos.map((n) => [n.id, layout[n.id] ?? [0, 0]])) as Layout;
    return { ...doc, steps: undefined, layout: usados };
  };
  const abrirJson = () => { setTexto(JSON.stringify(documento(), null, 2)); setErroTexto(null); setModo("json"); };
  const aplicarJson = (s: string) => {
    setTexto(s);
    try {
      const d = JSON.parse(s) as DocFluxo;
      if (typeof d !== "object" || !d) throw new Error(t.jsonObjeto);
      setDoc({ ...d, nodes: nosDe(d), steps: undefined, layout: undefined });
      setLayout(organizar(nosDe(d), d.layout));
      setErroTexto(null);
    } catch (err) { setErroTexto(err instanceof Error ? err.message : String(err)); }
  };
  const enviar = () => {
    setErroServidor(null);
    const fluxo = documento();
    if (!fluxo.description) delete fluxo.description;
    publicar.mutate({ sala, fluxo }, {
      onSuccess: (r) => { avisar("sucesso", t.publicado(r.nome, r.versao, r.pior_caso)); aoPublicar?.(r.nome); fechar(); },
      onError: (e) => setErroServidor(e instanceof ErroApi ? `${e.message}${e.codigo ? ` (${e.codigo})` : ""}` : String(e)),
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => { if (!a) fechar(); }}>
      <DialogContent showCloseButton className="flex h-[min(92dvh,900px)] w-[min(96vw,1400px)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 pr-12">
          <WorkflowIcon className="size-4 text-primary" aria-hidden />
          <DialogTitle className="font-mono text-sm">{doc.name || "?"}@{doc.version}</DialogTitle>
          <DialogDescription className="sr-only">{t.editorDescricao}</DialogDescription>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant={modo === "json" ? "secondary" : "ghost"} onClick={() => modo === "json" ? setModo("quadro") : abrirJson()}>
              <BracesIcon />{modo === "json" ? t.verQuadro : t.verJson}
            </Button>
            <Button size="sm" variant="ghost" disabled={modo === "json"} onClick={() => setLayout(organizar(nos, null, true))}><LayoutGridIcon />{t.organizar}</Button>
            <Button size="sm" variant={simulando ? "secondary" : "ghost"} disabled={modo === "json"} onClick={() => setSimulando(!simulando)}>
              <PlayIcon />{simulando ? t.pararSimulacao : t.simular}
            </Button>
            <Button size="sm" disabled={publicar.isPending || problemas.length > 0 || !!erroTexto} onClick={enviar}
              title={problemas.length ? t.corrijaAntes : t.publicarDica}><SendIcon />{t.publicar}</Button>
          </div>
        </div>

        {modo === "json" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
            <Textarea value={texto} onChange={(e) => aplicarJson(e.target.value)} aria-label={t.verJson} aria-invalid={!!erroTexto}
              className="min-h-0 flex-1 resize-none font-mono text-xs" spellCheck={false} />
            {erroTexto && <p className="text-xs text-destructive">{erroTexto}</p>}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav aria-label={t.paleta} className="flex flex-none gap-1 overflow-x-auto border-b p-2 md:w-40 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
              <span className="hidden px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:block">{t.adicionar}</span>
              {TIPOS_NO.map((tipo) => (
                <Button key={tipo} size="sm" variant="ghost" className="flex-none justify-start" onClick={() => adicionar(tipo)}>
                  <PlusIcon />{ROTULOS[tipo]}
                </Button>
              ))}
            </nav>
            <Fluxograma nos={nos} layout={layout} editavel={!simulando} caminho={caminho} comErro={comErro} selecionado={selecionado}
              className="min-h-72"
              aoSelecionar={setSelecionado}
              aoMover={(id, pos) => setLayout((l) => ({ ...l, [id]: pos }))}
              aoLigar={(de, porta, para) => mudarNos((ns) => ns.map((n) => n.id === de ? ligar(n, porta, para) : n))}
              aoDesligar={(de, porta) => mudarNos((ns) => ns.map((n) => n.id === de ? ligar(n, porta, porta.startsWith("case:") ? "" : undefined) : n))}
              aoApagar={apagar} />
            <aside className="max-h-[40dvh] flex-none overflow-y-auto border-t p-3 md:max-h-none md:w-80 md:border-t-0 md:border-l">
              {simulando ? (
                <div className="grid gap-3">
                  <span className="text-sm font-semibold">{t.simulacao}</span>
                  <p className="text-xs text-muted-foreground">{t.simulacaoDica}</p>
                  {desvios.length === 0 && <p className="text-xs text-muted-foreground">{t.semDesvios}</p>}
                  {desvios.map((d) => (
                    <div key={d.id} className="grid gap-1">
                      <Label className="font-mono text-xs">{d.id}{tipoDe(d) === "if" ? ` · ${String(d.if)}` : ` · ${String(d.switch)}`}</Label>
                      <NativeSelect className="h-8 text-xs" value={escolhas[d.id] ?? (tipoDe(d) === "if" ? "then" : "default")}
                        onChange={(e) => setEscolhas((es) => ({ ...es, [d.id]: e.target.value }))}>
                        {portasDe(d).map((p) => <option key={p} value={p}>{rotuloPorta(p)}</option>)}
                      </NativeSelect>
                    </div>
                  ))}
                  {caminho && (
                    <p className={cn("rounded-[var(--raio-md)] p-2 text-xs", caminho.fim === "end" ? "bg-primary/10" : "bg-destructive/10")}>
                      {t.fimSimulacao[caminho.fim](caminho.nos.length)}
                    </p>
                  )}
                </div>
              ) : no ? (
                <PainelNo key={no.id} no={no} nos={nos}
                  aoMudar={(n) => mudarNos((ns) => ns.map((x) => x.id === no.id ? n : x))}
                  aoRenomear={(novo) => { mudarNos((ns) => renomear(ns, no.id, novo)); setLayout((l) => ({ ...l, [novo]: l[no.id] ?? [0, 0] })); setSelecionado(novo); }}
                  aoApagar={() => apagar(no.id)} />
              ) : (
                <PainelFluxo doc={doc} aoMudar={(d) => { setDoc(d); setErroServidor(null); }} />
              )}
            </aside>
          </div>
        )}

        <footer className="flex max-h-32 flex-none flex-col gap-1 overflow-y-auto border-t px-4 py-2 text-xs">
          {erroServidor && <p className="flex items-start gap-1.5 text-destructive"><AlertTriangleIcon className="mt-0.5 size-3.5 flex-none" />{t.servidorRecusou(erroServidor)}</p>}
          {problemas.length === 0 ? (
            <p className="flex items-center gap-1.5 text-muted-foreground"><CircleCheckIcon className="size-3.5 text-primary" />{t.semProblemas(nos.length)}</p>
          ) : problemas.map((p, i) => (
            <button key={i} type="button" className="flex items-start gap-1.5 text-left text-destructive hover:underline" onClick={() => p.no && setSelecionado(p.no)}>
              <AlertTriangleIcon className="mt-0.5 size-3.5 flex-none" />{p.texto}
            </button>
          ))}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
