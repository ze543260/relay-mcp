import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CalendarClockIcon, CheckIcon, MicIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { corDe, ehIa, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { useEquipe, useReunioes, type Formato, type Reuniao } from "./api";
import { FotoPerfil } from "@/features/perfil/FotoPerfil";

const t = textos.reuniao;
const FORMATOS: Formato[] = ["daily", "planejamento", "revisao", "livre"];

function Pessoa({ nome, ativa }: { nome: string; ativa?: boolean }) {
  return (
    <Avatar title={nome} className={cn("size-6 ring-2 ring-background", !ehIa(nome) && "rounded-md after:rounded-md", ativa && "ring-primary")}>
      <FotoPerfil nome={nome} className={cn(!ehIa(nome) && "rounded-md")} />
      <AvatarFallback className={cn("text-[9px] font-semibold text-white", !ehIa(nome) && "rounded-md")} style={{ background: corDe(nome) }}>
        {siglaDe(nome)}
      </AvatarFallback>
    </Avatar>
  );
}

function useRestante(limite: string | null): string | null {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!limite) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [limite]);
  if (!limite) return null;
  const s = Math.max(0, Math.round((Date.parse(limite) - agora) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function DialogoAta({ reuniao, aberto, setAberto }: { reuniao: Reuniao; aberto: boolean; setAberto: (a: boolean) => void }) {
  const eq = useEquipe(reuniao.sala);
  const [ata, setAta] = useState("");
  const [acoes, setAcoes] = useState<{ titulo: string; responsavel: string }[]>([{ titulo: "", responsavel: "" }]);
  const validas = acoes.filter((a) => a.titulo.trim()).map((a) => ({ titulo: a.titulo.trim(), ...(a.responsavel ? { responsavel: a.responsavel } : {}) }));
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.ataTitulo(reuniao.titulo)}</DialogTitle>
          <DialogDescription>{t.ataDescricao}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="ata">{t.decisoes}</FieldLabel>
            <Textarea id="ata" value={ata} onChange={(e) => setAta(e.target.value)} rows={5} placeholder={t.ataPlaceholder} />
          </Field>
          <Field>
            <FieldLabel>{t.acoes}</FieldLabel>
            <div className="grid gap-2">
              {acoes.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={a.titulo} placeholder={t.acaoPlaceholder} aria-label={t.acaoPlaceholder} className="flex-1"
                    onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} />
                  <select value={a.responsavel} aria-label={t.responsavel}
                    onChange={(e) => setAcoes(acoes.map((x, j) => (j === i ? { ...x, responsavel: e.target.value } : x)))}
                    className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm">
                    <option value="">{t.semResponsavel}</option>
                    {reuniao.participantes.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <Button variant="ghost" size="icon" aria-label={t.removerAcao} onClick={() => setAcoes(acoes.filter((_, j) => j !== i))}><Trash2Icon /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setAcoes([...acoes, { titulo: "", responsavel: "" }])}>
                <PlusIcon /> {t.adicionarAcao}
              </Button>
            </div>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={!ata.trim() || eq.encerrar.isPending}
            onClick={() => eq.encerrar.mutate({ id: reuniao.id, ata: ata.trim(), acoes: validas }, { onSuccess: () => setAberto(false) })}>
            <CheckIcon /> {t.encerrar(validas.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Faixa da reunião em andamento: pauta, de quem é a vez, tempo e ações. */
export function FaixaReuniao({ sala, eu, admin }: { sala: string; eu: string; admin: boolean }) {
  const { data } = useReunioes(sala);
  const eq = useEquipe(sala);
  const [ataAberta, setAtaAberta] = useState(false);
  const navegar = useNavigate();
  const r = data?.find((x) => x.estado !== "encerrada");
  const noCanal = r?.canal === sala;
  const restante = useRestante(r?.estado === "aberta" ? r.limite_em : null);
  if (!r) return null;
  const minhaVez = r.vez === eu;
  const podePassar = minhaVez || admin || r.criada_por === eu;
  const podeEncerrar = r.participantes.includes(eu) || r.criada_por === eu || admin;

  return (
    <div role="region" aria-label={t.emAndamento}
      className={cn("border-b px-4 py-2.5 md:px-6", minhaVez ? "bg-primary/10" : "bg-superficie/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CalendarClockIcon className="size-4 flex-none text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">#{r.id} {r.titulo} <span className="font-normal text-muted-foreground">· {t.formatos[r.formato]}</span></p>
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {r.estado === "ata" ? t.faltaAta
              : <>{t.item(r.item + 1, r.pauta.length)}: <b className="font-medium text-foreground">{r.item_atual}</b> · {minhaVez ? t.suaVez : t.vezDe(r.vez ?? "")}</>}
          </p>
        </div>
        <div className="flex -space-x-1.5" aria-label={t.participantes}>
          {r.participantes.map((p) => <Pessoa key={p} nome={p} ativa={p === r.vez} />)}
        </div>
        {restante && <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-label={t.tempoRestante}>{restante}</span>}
        <div className="flex gap-1.5">
          {noCanal && r.estado === "aberta" && podePassar && (
            <Button size="sm" variant={minhaVez ? "default" : "outline"} disabled={eq.passarVez.isPending} onClick={() => eq.passarVez.mutate(r.id)}>
              <MicIcon /> {minhaVez ? t.passarMinha : t.passar}
            </Button>
          )}
          {!noCanal && (
            <Button size="sm" variant={minhaVez ? "default" : "outline"} onClick={() => void navegar({ to: "/s/$sala", params: { sala: r.canal } })}>
              {t.entrar} <ArrowRightIcon />
            </Button>
          )}
          {podeEncerrar && (
            <Button size="sm" variant={r.estado === "ata" ? "default" : "ghost"} onClick={() => setAtaAberta(true)}>{t.ata}</Button>
          )}
        </div>
      </div>
      {r.estado === "aberta" && (
        <ol className="mt-2 flex gap-1" aria-label={t.pauta}>
          {r.pauta.map((p, i) => (
            <li key={p} title={p} className={cn("h-1 flex-1 rounded-full", i < r.item ? "bg-primary" : i === r.item ? "bg-primary/50" : "bg-border")} />
          ))}
        </ol>
      )}
      <DialogoAta reuniao={r} aberto={ataAberta} setAberto={setAtaAberta} />
    </div>
  );
}

/** Diálogo para abrir uma reunião (formato com pauta pronta, participantes, tempo). */
export function NovaReuniao({ sala, eu, candidatos, aberto, setAberto }: {
  sala: string; eu: string; candidatos: { nome: string; online: boolean }[]; aberto: boolean; setAberto: (a: boolean) => void;
}) {
  const eq = useEquipe(sala);
  const [formato, setFormato] = useState<Formato>("daily");
  const [titulo, setTitulo] = useState("");
  const [minutos, setMinutos] = useState(15);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const lista = candidatos.filter((c) => c.nome !== "relay").sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome));
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.novaTitulo}</DialogTitle>
          <DialogDescription>{t.novaDescricao}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>{t.formato}</FieldLabel>
            <div role="radiogroup" aria-label={t.formato} className="grid grid-cols-2 gap-1.5">
              {FORMATOS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={formato === f} onClick={() => setFormato(f)}
                  className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    formato === f ? "border-primary bg-accent" : "hover:bg-muted")}>
                  <b className="block font-medium">{t.formatos[f]}</b>
                  <span className="text-xs text-muted-foreground">{t.formatosDescricao[f]}</span>
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field>
              <FieldLabel htmlFor="titulo-reuniao">{t.titulo}</FieldLabel>
              <Input id="titulo-reuniao" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t.formatos[formato]} maxLength={120} />
            </Field>
            <Field>
              <FieldLabel htmlFor="minutos">{t.minutos}</FieldLabel>
              <Input id="minutos" type="number" min={0} max={240} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
            </Field>
          </div>
          <Field>
            <FieldLabel>{t.participantesOrdem}</FieldLabel>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-1.5">
              {lista.map((c) => {
                const ordem = escolhidos.indexOf(c.nome);
                return (
                  <label key={c.nome} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 hover:bg-muted">
                    <Checkbox checked={ordem >= 0}
                      onCheckedChange={(v) => setEscolhidos(v ? [...escolhidos, c.nome] : escolhidos.filter((x) => x !== c.nome))} />
                    <Pessoa nome={c.nome} />
                    <span className="flex-1 truncate text-sm">{c.nome}{c.nome === eu && <span className="text-muted-foreground"> ({t.voce})</span>}</span>
                    {c.online && <i className="size-1.5 rounded-full bg-ok" aria-label={textos.conversa.online} />}
                    {ordem >= 0 && <span className="w-4 text-right font-mono text-xs text-primary">{ordem + 1}</span>}
                  </label>
                );
              })}
            </div>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={escolhidos.length === 0 || eq.criarReuniao.isPending}
            onClick={() => eq.criarReuniao.mutate(
              { formato, participantes: escolhidos, ...(titulo.trim() ? { titulo: titulo.trim() } : {}), ...(minutos > 0 ? { minutos } : {}) },
              { onSuccess: () => { setAberto(false); setEscolhidos([]); setTitulo(""); } })}>
            {t.abrir}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
