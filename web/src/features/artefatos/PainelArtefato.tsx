import { ArchiveIcon, CheckIcon, GitCompareIcon, PencilIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import { useArtefato, useMexerArtefato, useVersoes, type ArtefatoComConteudo } from "./api";

const Visualizador = lazy(() => import("./Visualizador"));
const t = textos.artefatos;

/** Diff de linhas (LCS) entre duas versões de texto; suficiente pra planos e mockups de até 200 KB. */
function diffLinhas(antes: string, depois: string): { tipo: "=" | "+" | "-"; linha: string }[] {
  const a = antes.split("\n"), b = depois.split("\n");
  if (a.length * b.length > 4_000_000) return [{ tipo: "=", linha: t.diffGrande }];
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const saida: { tipo: "=" | "+" | "-"; linha: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { saida.push({ tipo: "=", linha: a[i]! }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) saida.push({ tipo: "-", linha: a[i++]! });
    else saida.push({ tipo: "+", linha: b[j++]! });
  }
  while (i < a.length) saida.push({ tipo: "-", linha: a[i++]! });
  while (j < b.length) saida.push({ tipo: "+", linha: b[j++]! });
  return saida;
}

function Comparar({ id, artefato }: { id: number; artefato: ArtefatoComConteudo }) {
  const anterior = useArtefato(artefato.versao_vista > 1 ? id : null, artefato.versao_vista - 1);
  const linhas = useMemo(() => anterior.data ? diffLinhas(anterior.data.conteudo, artefato.conteudo) : [], [anterior.data, artefato.conteudo]);
  if (artefato.versao_vista <= 1) return <p className="text-sm text-muted-foreground">{t.semAnterior}</p>;
  if (!anterior.data) return <Skeleton className="h-40" />;
  return (
    <pre aria-label={t.comparar} className="max-h-[70vh] overflow-auto rounded-[var(--raio-lg)] border bg-superficie p-2 font-mono text-xs leading-5">
      {linhas.map((l, n) => (
        <div key={n} className={cn("px-1 whitespace-pre-wrap [overflow-wrap:anywhere]",
          l.tipo === "+" && "bg-primary/15", l.tipo === "-" && "bg-destructive/15 text-muted-foreground line-through")}>
          <span aria-hidden className="mr-2 select-none opacity-60">{l.tipo === "=" ? " " : l.tipo}</span>{l.linha || " "}
        </div>
      ))}
    </pre>
  );
}

function Editor({ artefato, fechar }: { artefato: ArtefatoComConteudo; fechar: () => void }) {
  const { salvar } = useMexerArtefato();
  const [conteudo, setConteudo] = useState(artefato.conteudo);
  const [resumo, setResumo] = useState("");
  return (
    <div className="grid gap-2">
      <Textarea autoFocus value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={18} aria-label={t.conteudo}
        className="font-mono text-xs" />
      <Input value={resumo} onChange={(e) => setResumo(e.target.value)} maxLength={200} placeholder={t.resumoPlaceholder} aria-label={t.resumo} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={fechar}>{textos.conversa.cancelar}</Button>
        <Button size="sm" disabled={!conteudo.trim() || conteudo === artefato.conteudo || salvar.isPending}
          onClick={() => salvar.mutate({ id: artefato.id, conteudo, base: artefato.versao, resumo }, { onSuccess: fechar })}>
          {t.salvarVersao(artefato.versao + 1)}
        </Button>
      </div>
    </div>
  );
}

/** Painel do artefato: render isolado, versões, comparar com a anterior, editar, aprovar/arquivar. */
export default function PainelArtefato({ id, fechar, admin }: { id: number | null; fechar: () => void; admin: boolean }) {
  const [versao, setVersao] = useState<number | undefined>(undefined);
  const [modo, setModo] = useState<"ver" | "comparar" | "editar">("ver");
  const { data: a, isPending } = useArtefato(id, versao);
  const { data: versoes } = useVersoes(id);
  const { decidir } = useMexerArtefato();
  const vendoAtual = a ? a.versao_vista === a.versao : true;

  return (
    <Sheet open={id !== null} onOpenChange={(aberto) => { if (!aberto) { setVersao(undefined); setModo("ver"); fechar(); } }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {isPending || !a ? (
          <div className="grid gap-3 p-4"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-80" /></div>
        ) : (
          <>
            <SheetHeader className="gap-1.5 border-b pr-12">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">#{a.id}</span>
                <Badge variant="outline">{t.tipos[a.tipo]}</Badge>
                <Badge variant={a.estado === "aprovado" ? "default" : "outline"}>{t.estados[a.estado]}</Badge>
              </div>
              <SheetTitle className="text-base">{a.titulo}</SheetTitle>
              <SheetDescription className="text-xs">{t.versaoPor(a.versao_vista, a.autor_versao, a.resumo)}</SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <NativeSelect value={a.versao_vista} aria-label={t.versao}
                  onChange={(e) => { const v = Number(e.target.value); setVersao(v === a.versao ? undefined : v); setModo("ver"); }}>
                  {(versoes ?? [{ versao: a.versao, autor: a.autor_versao ?? "", resumo: null, criado_em: a.versao_em, tamanho: 0 }]).map((v) => (
                    <option key={v.versao} value={v.versao}>{t.opcaoVersao(v.versao, v.autor, v.versao === a.versao)}</option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant={modo === "comparar" ? "secondary" : "ghost"} disabled={a.versao_vista <= 1}
                  onClick={() => setModo(modo === "comparar" ? "ver" : "comparar")}><GitCompareIcon />{t.comparar}</Button>
                {vendoAtual && a.estado !== "arquivado" && (
                  <Button size="sm" variant={modo === "editar" ? "secondary" : "ghost"} onClick={() => setModo(modo === "editar" ? "ver" : "editar")}>
                    <PencilIcon />{t.editar}
                  </Button>
                )}
                <span className="ml-auto flex gap-1.5">
                  {a.estado !== "arquivado" && (
                    <Button size="sm" variant="outline" disabled={decidir.isPending} title={admin ? t.soHumano : undefined}
                      onClick={() => decidir.mutate({ id: a.id, acao: "arquivar" })}><ArchiveIcon />{t.arquivar}</Button>
                  )}
                  {a.estado !== "aprovado" && vendoAtual && (
                    <Button size="sm" disabled={decidir.isPending} title={admin ? t.soHumano : undefined}
                      onClick={() => decidir.mutate({ id: a.id, acao: "aprovar" })}><CheckIcon />{t.aprovar}</Button>
                  )}
                </span>
              </div>
            </SheetHeader>
            <div className="p-4">
              {modo === "editar" ? <Editor key={a.versao} artefato={a} fechar={() => setModo("ver")} />
                : modo === "comparar" ? <Comparar id={a.id} artefato={a} />
                : <Suspense fallback={<Skeleton className="h-80" />}><Visualizador tipo={a.tipo} conteudo={a.conteudo} titulo={a.titulo} /></Suspense>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
