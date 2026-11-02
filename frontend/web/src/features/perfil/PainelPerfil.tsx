import { CameraIcon, ChevronRightIcon, KeyRoundIcon, LoaderIcon, ListTodoIcon, NetworkIcon, PencilIcon, UserRoundIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { corDe, ehIa, horaDe, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { useEditarPerfil, useGrafo, usePerfil, type Perfil, type Persona } from "./api";
import { FotoPerfil, urlFoto } from "@/features/perfil/FotoPerfil";
import type { Fato } from "@/features/memoria/api";

const t = textos.perfil;
// d3-force só carrega quando a memória do agente aparece.
const GrafoMemoria = lazy(() => import("@/features/memoria/Grafo"));
const CAMPOS = [["equipe", 60], ["papel", 160], ["foco", 160], ["tom", 80], ["limites", 240]] as const;

function Secao({ icone: Icone, titulo, children }: { icone: typeof UserRoundIcon; titulo: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icone className="size-3.5" aria-hidden />{titulo}</h3>
      {children}
    </section>
  );
}

function FichaPersona({ perfil }: { perfil: Perfil }) {
  const [editando, setEditando] = useState(false);
  const { persona: salvar } = useEditarPerfil(perfil.nome);
  const p = perfil.persona;
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  function abrir() {
    setRascunho(Object.fromEntries(CAMPOS.map(([c]) => [c, p?.[c] ?? ""])));
    setEditando(true);
  }
  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate(rascunho as unknown as Persona, { onSuccess: () => setEditando(false) });
  }
  if (editando) {
    return (
      <form onSubmit={enviar} className="grid gap-2">
        {CAMPOS.map(([c, max]) => (
          <label key={c} className="grid gap-1 text-xs font-medium text-muted-foreground">
            {t.campos[c]}
            <Input value={rascunho[c] ?? ""} maxLength={max} placeholder={t.exemplos[c]}
              onChange={(e) => setRascunho((r) => ({ ...r, [c]: e.target.value }))} className="h-8 text-sm" />
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(false)}>{textos.conversa.cancelar}</Button>
          <Button type="submit" size="sm" disabled={salvar.isPending}>{t.salvar}</Button>
        </div>
      </form>
    );
  }
  const preenchidos = CAMPOS.filter(([c]) => p?.[c]);
  return (
    <div className="grid gap-1.5">
      {preenchidos.length === 0 ? <p className="text-sm text-muted-foreground">{t.semFicha}</p> : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {preenchidos.map(([c]) => (
            <div key={c} className="contents"><dt className="text-muted-foreground">{t.campos[c]}</dt><dd className="[overflow-wrap:anywhere]">{p![c]}</dd></div>
          ))}
        </dl>
      )}
      {p?.editado_por && <p className="text-[11px] text-muted-foreground">{t.editadoPor(p.editado_por)}</p>}
      {perfil.pode_editar && (
        <Button size="sm" variant="outline" className="justify-self-start" onClick={abrir}><PencilIcon />{t.editarFicha}</Button>
      )}
    </div>
  );
}

/** Memória da IA: assuntos ligados a ela; clicar num assunto destrincha (migalhas pra voltar). */
/**
 * Memória do agente em grafo (o mesmo desenho da aba Memória): o agente no centro, com o que ele registrou e o que
 * se sabe dele. Clicar num nó recentra nele; a trilha volta pelos passos.
 */
function MemoriaDoAgente({ nome, sala }: { nome: string; sala: string }) {
  const [trilha, setTrilha] = useState<string[]>([]);
  const rotulos = useRef(new Map<string, string>());
  const atual = trilha.at(-1);
  const { data: g, isPending, isError } = useGrafo(sala, atual ? { sujeito: atual } : { agente: nome });
  for (const n of g?.nos ?? []) rotulos.current.set(n.nome, n.rotulo);
  // O grafo da aba Memória desenha fatos; as arestas da vizinhança viram fatos com os rótulos de exibição.
  const fatos = useMemo<Fato[]>(() => {
    if (!g) return [];
    const r = new Map(g.nos.map((n) => [n.nome, n.rotulo]));
    return g.arestas.map((a) => ({
      id: a.fato, sala, sujeito: r.get(a.de) ?? a.de, predicado: a.predicado, objeto: r.get(a.para) ?? a.para,
      origem: a.origem as Fato["origem"], estado: "vigente", supera: null, superado_por: null, autor: a.autor,
      confirmado_por: null, criado_em: "",
    }));
  }, [g, sala]);
  const centros = useMemo(() => (g?.centros ?? []).map((c) => rotulos.current.get(c) ?? c), [g]);
  if (isError) return <p className="text-sm text-muted-foreground">{t.semGrafo}</p>;
  if (isPending || !g) return <Skeleton className="h-72" />;
  const porRotulo = new Map(g.nos.map((n) => [n.rotulo.toLowerCase(), n.nome]));
  return (
    <div className="grid gap-2">
      <nav aria-label={t.trilha} className="flex flex-wrap items-center gap-1 text-xs">
        <button type="button" onClick={() => setTrilha([])} className={cn("rounded px-1 hover:bg-muted", !atual && "font-semibold")}>{nome}</button>
        {trilha.map((s, i) => (
          <span key={`${s}-${i}`} className="flex items-center gap-1">
            <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden />
            <button type="button" onClick={() => setTrilha(trilha.slice(0, i + 1))}
              className={cn("rounded px-1 hover:bg-muted", i === trilha.length - 1 && "font-semibold")}>{rotulos.current.get(s) ?? s}</button>
          </span>
        ))}
      </nav>
      {fatos.length === 0 ? <p className="text-sm text-muted-foreground">{t.semFatos}</p> : (
        <div className="flex h-72 flex-col overflow-hidden rounded-[var(--raio-lg)] border">
          <Suspense fallback={<Skeleton className="flex-1" />}>
            <GrafoMemoria key={trilha.join("/")} fatos={fatos} selecionado={null} centros={centros}
              aoSelecionar={(rotulo) => {
                const alvo = rotulo ? porRotulo.get(rotulo.toLowerCase()) : undefined;
                if (alvo && !g.centros.includes(alvo)) setTrilha([...trilha, alvo]);
              }} />
          </Suspense>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t.dicaGrafo}</p>
      {g.cortado && <p className="text-[11px] text-muted-foreground">{t.cortado}</p>}
    </div>
  );
}

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dataHora = (iso: string) => fmtDataHora.format(new Date(iso));

function Acesso({ perfil, admin }: { perfil: Perfil; admin: boolean }) {
  const [confirmar, setConfirmar] = useState(false);
  const { revogar } = useEditarPerfil(perfil.nome);
  const a = perfil.acesso!;
  return (
    <div className="grid gap-2 text-sm">
      <p>{a.token_ativo && a.criado_em ? t.tokenAtivo(new Date(a.criado_em).toLocaleDateString("pt-BR")) : a.so_admin ? t.soAdmin : t.semToken}</p>
      {!!a.dispositivos?.length && (
        <div className="grid gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground" title={t.dispositivosDica}>{t.dispositivos}</h4>
          <ul className="grid gap-1.5">
            {a.dispositivos.map((d, i) => (
              <li key={i} className="grid">
                <span className="font-medium">{d.rotulo}</span>
                <span className="text-xs text-muted-foreground">
                  {[t.vistoDesde(dataHora(d.ultimo_em), dataHora(d.primeiro_em)), d.ip, t.viaDispositivo[d.via]].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {admin && a.token_ativo && (
        <Button size="sm" variant="outline" className="justify-self-start text-destructive" onClick={() => setConfirmar(true)}>{t.revogar}</Button>
      )}
      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revogarTitulo(perfil.apelido ?? perfil.nome)}</AlertDialogTitle>
            <AlertDialogDescription>{t.revogarDescricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{textos.conversa.cancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => revogar.mutate()}>{t.revogar}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Avatar do cabeçalho; pro dono vira botão de trocar foto (e remover, se tiver). */
function FotoEditavel({ perfil: p, ia }: { perfil: Perfil; ia: boolean }) {
  const { foto } = useEditarPerfil(p.nome);
  const entrada = useRef<HTMLInputElement>(null);
  const forma = ia ? "rounded-full" : "rounded-[28px]";
  const remover = p.foto && p.pode_editar ? (
    <button type="button" onClick={() => foto.mutate(null)} disabled={foto.isPending}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t.removerFoto}</button>
  ) : null;
  return (
    <div className="grid justify-items-center gap-1.5">
      <div className="relative">
        <Avatar aria-hidden className={cn("size-28 shadow-lg ring-4 ring-background", forma, ia ? "after:rounded-full" : "after:rounded-[28px]")}>
          <FotoPerfil nome={p.nome} className={forma} />
          <AvatarFallback className={cn("text-3xl font-semibold text-white", forma)} style={{ background: corDe(p.nome) }}>
            {siglaDe(p.nome)}
          </AvatarFallback>
        </Avatar>
        <span aria-hidden className={cn("absolute right-1.5 bottom-1.5 size-4 rounded-full ring-3 ring-background",
          p.online ? "bg-emerald-500" : "bg-muted-foreground/50", !ia && "right-0 bottom-0")} />
        {p.pode_trocar_foto && (
          <>
            <Button type="button" size="icon" variant="secondary" onClick={() => entrada.current?.click()} disabled={foto.isPending}
              aria-label={t.trocarFoto} title={t.trocarFoto}
              className="absolute -top-1 -right-1 size-8 rounded-full shadow-md ring-3 ring-background">
              {foto.isPending ? <LoaderIcon className="animate-spin" /> : <CameraIcon />}
            </Button>
            <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) foto.mutate(f); }} />
          </>
        )}
      </div>
      {remover}
    </div>
  );
}

/** Perfil de um participante: identidade, ficha de persona, trabalho, memória e (pro dono) acesso. */
export default function PainelPerfil({ nome, sala, admin, fechar }: { nome: string | null; sala: string; admin: boolean; fechar: () => void }) {
  const { data: p, isPending, isError } = usePerfil(nome);
  const ia = nome ? ehIa(nome) : false;
  return (
    <Sheet open={nome !== null} onOpenChange={(aberto) => { if (!aberto) fechar(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {isError ? <p className="p-6 text-sm text-muted-foreground">{t.naoEncontrado}</p>
          : isPending || !p ? <div className="grid gap-3 p-4"><Skeleton className="h-14" /><Skeleton className="h-40" /></div> : (
          <>
            <SheetHeader className="relative isolate shrink-0 items-center gap-3 overflow-hidden border-b px-4 pt-8 pb-5 text-center">
              {/* Capa: a própria foto, desfocada, tingindo o topo. */}
              {p.foto ? <img aria-hidden src={urlFoto(p.nome, p.foto)} alt=""
                className="absolute inset-x-0 top-0 -z-10 h-24 w-full scale-125 object-cover opacity-50 blur-2xl" />
                : <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-24 opacity-30" style={{ background: corDe(p.nome) }} />}
              <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-24 bg-linear-to-b from-transparent to-background" />
              <FotoEditavel perfil={p} ia={ia} />
              <div className="grid min-w-0 justify-items-center gap-1">
                <SheetTitle className="max-w-full truncate text-lg">{p.apelido ?? p.nome}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
                  {p.apelido && <span className="font-mono">{p.nome}</span>}
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">{p.tipo === "ia" ? t.ia : t.humano}</Badge>
                  {p.dono && <span>{t.doDono(p.dono)}</span>}
                </SheetDescription>
                <span className="text-[11px] text-muted-foreground">
                  {p.online ? t.online : p.visto_em ? t.vistoEm(horaDe(Date.parse(p.visto_em))) : t.nuncaVisto}
                </span>
              </div>
            </SheetHeader>
            <div className="grid gap-6 p-4">
              <Secao icone={UserRoundIcon} titulo={t.persona}><FichaPersona perfil={p} /></Secao>
              <Secao icone={ListTodoIcon} titulo={t.tarefas(p.tarefas.length)}>
                {p.tarefas.length === 0 ? <p className="text-sm text-muted-foreground">{t.semTarefas}</p> : (
                  <ul className="grid gap-1 text-sm">
                    {p.tarefas.map((x) => (
                      <li key={x.id} className="flex gap-2"><span className="font-mono text-xs text-muted-foreground">#{x.id}</span>
                        <span className="min-w-0 flex-1 truncate">{x.titulo}</span>
                        <span className="text-xs text-muted-foreground">{textos.equipe.colunas[x.status as keyof typeof textos.equipe.colunas] ?? x.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
              {p.tipo === "ia" && (
                <Secao icone={NetworkIcon} titulo={t.memoria(p.fatos_registrados)}><MemoriaDoAgente key={p.nome} nome={p.nome} sala={sala} /></Secao>
              )}
              {p.acesso && <Secao icone={KeyRoundIcon} titulo={t.acesso}><Acesso perfil={p} admin={admin} /></Secao>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
