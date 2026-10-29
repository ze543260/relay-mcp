import { BrainIcon, CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import { useCandidatos, useDecidirFato, useFatos, type Fato } from "./api";

const t = textos.memoria;

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

/** Selo da origem; mensagem é clicável e leva até ela na conversa. */
function Origem({ fato, abrir }: { fato: Fato; abrir: (msgId: number) => void }) {
  const rotulo = t.deOrigem(t.origem[fato.origem.tipo] ?? fato.origem.tipo, fato.origem.id);
  const classe = "inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4";
  if (fato.origem.tipo !== "msg") return <span className={classe}>{rotulo}</span>;
  return (
    <button type="button" onClick={() => abrir(Number(fato.origem.id))} title={t.abrirOrigem}
      className={cn(classe, "text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring")}>
      {rotulo}
    </button>
  );
}

function LinhaFato({ fato, abrir, comSujeito = false }: { fato: Fato; abrir: (msgId: number) => void; comSujeito?: boolean }) {
  const antigo = fato.estado === "superado" || fato.estado === "rejeitado";
  return (
    <li className={cn("grid gap-1 py-2", antigo && "opacity-60")}>
      <p className={cn("text-sm [overflow-wrap:anywhere]", antigo && "line-through decoration-muted-foreground/60")}>
        {comSujeito && <b className="font-semibold">{fato.sujeito} </b>}
        <span className="text-muted-foreground">{fato.predicado}</span> {fato.objeto}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono">#{fato.id}</span>
        <Origem fato={fato} abrir={abrir} />
        <span>{t.por(fato.autor)}</span>
        {fato.confirmado_por && <span>· {t.confirmadoPor(fato.confirmado_por)}</span>}
        <time dateTime={fato.criado_em} className="tabular-nums">· {dataCurta(fato.criado_em)}</time>
        {fato.supera && <span>· {t.supera(fato.supera)}</span>}
        {fato.superado_por && <Badge variant="outline" className="h-4 px-1 text-[10px]">{t.superadoPor(fato.superado_por)}</Badge>}
        {fato.estado === "rejeitado" && <Badge variant="outline" className="h-4 px-1 text-[10px]">{t.estados.rejeitado}</Badge>}
      </div>
    </li>
  );
}

function Candidatos({ sala, admin, abrir }: { sala: string; admin: boolean; abrir: (msgId: number) => void }) {
  const { data: candidatos } = useCandidatos(sala);
  const decidir = useDecidirFato(sala);
  if (!candidatos?.length) return null;
  return (
    <section aria-label={t.candidatos(candidatos.length)}
      className="grid gap-2 rounded-[var(--raio-xl)] border border-primary/40 bg-primary/5 p-3 md:p-4">
      <h2 className="text-sm font-semibold">{t.candidatos(candidatos.length)}</h2>
      <p className="text-xs text-muted-foreground">{admin ? t.soHumano : t.candidatosDica}</p>
      <ul className="divide-y">
        {candidatos.map((f) => (
          <li key={f.id} className="flex flex-wrap items-start gap-2 py-1">
            <div className="min-w-0 flex-1"><ul><LinhaFato fato={f} abrir={abrir} comSujeito /></ul></div>
            <div className="flex gap-1.5 pt-2">
              <Button size="sm" variant="outline" disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: f.id, acao: "rejeitar" })}><XIcon />{t.rejeitar}</Button>
              <Button size="sm" disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: f.id, acao: "confirmar" })}><CheckIcon />{t.confirmar}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Aba Memória: fatos da equipe com origem, agrupados por assunto; candidatos de ata no topo. */
export default function Memoria({ sala, admin, abrirMensagem }: { sala: string; admin: boolean; abrirMensagem: (id: number) => void }) {
  const [busca, setBusca] = useState("");
  const [historico, setHistorico] = useState(false);
  const termo = useDeferredValue(busca.trim());
  const { data: fatos, isPending } = useFatos(sala, termo, historico);

  // Agrupa por sujeito (sem diferenciar maiúsculas), na ordem em que o servidor devolveu (relevância/recência).
  const grupos = useMemo(() => {
    const mapa = new Map<string, { sujeito: string; fatos: Fato[] }>();
    for (const f of (fatos ?? []).filter((x) => historico || x.estado === "vigente")) {
      const chave = f.sujeito.toLowerCase();
      const g = mapa.get(chave) ?? { sujeito: f.sujeito, fatos: [] };
      g.fatos.push(f);
      mapa.set(chave, g);
    }
    return [...mapa.values()];
  }, [fatos, historico]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="search" aria-label={t.buscar} className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <BrainIcon className="size-4 text-primary" aria-hidden />
        <div className="relative min-w-40 flex-1 sm:max-w-80">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t.buscar} aria-label={t.buscar}
            className="h-8 bg-card pl-7 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={historico} onCheckedChange={(v) => setHistorico(Boolean(v))} />
          {t.historico}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-3xl gap-4">
          <Candidatos sala={sala} admin={admin} abrir={abrirMensagem} />
          {isPending ? (
            <div className="grid gap-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : grupos.length === 0 ? (
            <div className="mx-auto mt-[12vh] max-w-96 text-center text-muted-foreground">
              <BrainIcon className="mx-auto mb-3 size-8 opacity-50" aria-hidden />
              <h2 className="mb-1.5 text-[15px] font-semibold text-foreground">{termo ? t.semResultado(termo) : t.vazio}</h2>
              {!termo && <p className="text-sm">{t.vazioDica}</p>}
            </div>
          ) : (
            grupos.map((g) => (
              <section key={g.sujeito} aria-label={g.sujeito} className="rounded-[var(--raio-xl)] border bg-card px-4 py-2 shadow-xs">
                <h2 className="pt-1 text-[13px] font-semibold">{g.sujeito}</h2>
                <ul className="divide-y">{g.fatos.map((f) => <LinhaFato key={f.id} fato={f} abrir={abrirMensagem} />)}</ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
