import { CameraIcon, ChevronRightIcon, CircleDotIcon, KeyRoundIcon, LoaderIcon, ListTodoIcon, NetworkIcon, PencilIcon, UserRoundIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
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
import { FotoPerfil } from "@/features/perfil/FotoPerfil";

const t = textos.perfil;
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
function MemoriaDoAgente({ nome, sala }: { nome: string; sala: string }) {
  const [trilha, setTrilha] = useState<string[]>([]);
  const rotulos = useRef(new Map<string, string>());
  const atual = trilha.at(-1);
  const { data: g, isPending, isError } = useGrafo(sala, atual ? { sujeito: atual } : { agente: nome });
  if (isError) return <p className="text-sm text-muted-foreground">{t.semGrafo}</p>;
  for (const n of g?.nos ?? []) rotulos.current.set(n.nome, n.rotulo);
  if (isPending || !g) return <Skeleton className="h-24" />;
  const porPredicado = new Map<string, typeof g.arestas>();
  for (const a of g.arestas) porPredicado.set(a.predicado, [...(porPredicado.get(a.predicado) ?? []), a]);
  const rotulo = new Map(g.nos.map((n) => [n.nome, n.rotulo]));
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
      {g.arestas.length === 0 ? <p className="text-sm text-muted-foreground">{t.semFatos}</p> : (
        <ul key={trilha.join("/")} className="grid gap-2">
          {[...porPredicado].map(([pred, arestas]) => (
            <li key={pred} className="grid gap-1">
              <span className="text-xs text-muted-foreground">{pred}</span>
              <div className="flex flex-wrap gap-1.5">
                {arestas.map((a, i) => {
                  // Cascata: cada chip do nível entra 20 ms depois do anterior.
                  const cascata = { animationDelay: `${Math.min(i, 15) * 20}ms` };
                  // Sobre o centro: mostra o outro lado. Só registrado por ele: mostra a relação inteira.
                  const r = (n: string) => rotulo.get(n) ?? n;
                  const sai = g.centros.includes(a.de), entra = g.centros.includes(a.para);
                  const outro = sai ? a.para : a.de;
                  const navegavel = rotulo.has(outro) && (entra || !a.folha || !sai);
                  const texto = sai ? r(a.para) : entra ? `← ${r(a.de)}` : `${r(a.de)} → ${r(a.para)}`;
                  return navegavel ? (
                    <button key={a.fato} type="button" onClick={() => setTrilha([...trilha, outro])} title={t.origemDe(a.origem.tipo, a.origem.id, a.autor)} style={cascata}
                      className="motion-safe:animate-[entra_var(--mov-padrao)_var(--mov-curva)_both] rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10">{texto}</button>
                  ) : (
                    <span key={a.fato} title={t.origemDe(a.origem.tipo, a.origem.id, a.autor)} style={cascata}
                      className="motion-safe:animate-[entra_var(--mov-padrao)_var(--mov-curva)_both] rounded-full border px-2 py-0.5 text-xs [overflow-wrap:anywhere]">{texto}</span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {g.cortado && <p className="text-[11px] text-muted-foreground">{t.cortado}</p>}
    </div>
  );
}

function Acesso({ perfil, admin }: { perfil: Perfil; admin: boolean }) {
  const [confirmar, setConfirmar] = useState(false);
  const { revogar } = useEditarPerfil(perfil.nome);
  const a = perfil.acesso!;
  return (
    <div className="grid gap-2 text-sm">
      <p>{a.token_ativo ? t.tokenAtivo(new Date(a.criado_em).toLocaleDateString("pt-BR")) : t.semToken}</p>
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
  const avatar = (
    <Avatar aria-hidden className={cn("size-12", !ia && "rounded-xl after:rounded-xl")}>
      <FotoPerfil nome={p.nome} className={cn(!ia && "rounded-xl")} />
      <AvatarFallback className={cn("text-base font-semibold text-white", !ia && "rounded-xl")} style={{ background: corDe(p.nome) }}>
        {siglaDe(p.nome)}
      </AvatarFallback>
    </Avatar>
  );
  // Trocar: só a própria pessoa ou o dono do agente. Remover: também o admin (moderação).
  if (!p.pode_trocar_foto) return p.pode_editar && p.foto ? (
    <div className="grid justify-items-center gap-0.5">{avatar}
      <button type="button" onClick={() => foto.mutate(null)} disabled={foto.isPending}
        className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t.removerFoto}</button>
    </div>
  ) : avatar;
  return (
    <div className="grid justify-items-center gap-0.5">
      <button type="button" onClick={() => entrada.current?.click()} disabled={foto.isPending} aria-label={t.trocarFoto}
        title={t.trocarFoto} className={cn("group relative rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", !ia && "rounded-xl")}>
        {avatar}
        <span aria-hidden className={cn("absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
          !ia && "rounded-xl", foto.isPending && "opacity-100")}>
          {foto.isPending ? <LoaderIcon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
        </span>
      </button>
      <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) foto.mutate(f); }} />
      {!!p.foto && <button type="button" onClick={() => foto.mutate(null)} disabled={foto.isPending}
        className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t.removerFoto}</button>}
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
            <SheetHeader className="flex-row items-center gap-3 border-b pr-12">
              <FotoEditavel perfil={p} ia={ia} />
              <div className="grid min-w-0 gap-0.5">
                <SheetTitle className="truncate text-base">{p.apelido ?? p.nome}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                  {p.apelido && <span className="font-mono">{p.nome}</span>}
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">{p.tipo === "ia" ? t.ia : t.humano}</Badge>
                  {p.dono && <span>{t.doDono(p.dono)}</span>}
                </SheetDescription>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CircleDotIcon className={cn("size-3", p.online ? "text-emerald-500" : "opacity-50")} aria-hidden />
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
