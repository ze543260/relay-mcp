import { BrainIcon, FileCodeIcon, HashIcon, KanbanIcon, LoaderIcon, MessageSquareIcon, PlusIcon, UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { marcar, textoPlano, useBusca } from "@/features/busca/api";
import { normalizarNome } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { useSalas } from "./useSalas";

export type Destino =
  | { tipo: "sala"; sala: string }
  | { tipo: "mensagem"; sala: string; id: number }
  | { tipo: "tarefa"; sala: string; id: number }
  | { tipo: "artefato"; sala: string; id: number }
  | { tipo: "fato"; sala: string }
  | { tipo: "pessoa"; nome: string };

interface Props {
  aberta: boolean;
  setAberta: (a: boolean) => void;
  salaAtual: string;
  aoIr: (d: Destino) => void;
}

const t = textos.paleta;

function Marcado({ texto, q }: { texto: string; q: string }) {
  return <>{marcar(texto, q).map((p, i) => p.achou ? <mark key={i} className="rounded-sm bg-acento-fundo text-foreground">{p.t}</mark> : p.t)}</>;
}

/** Ctrl/Cmd+K: salas (no cliente) + mensagens, memória, tarefas, artefatos e pessoas (rota /busca). */
export function PaletaSalas({ aberta, setAberta, salaAtual, aoIr }: Props) {
  const { data: salas = [] } = useSalas();
  const [busca, setBusca] = useState("");
  const q = busca.trim();
  const { data: r, isFetching } = useBusca(q);
  const nova = normalizarNome(busca);
  const existe = salas.some((s) => s.sala === nova);
  const termo = q.toLowerCase();
  const salasFiltradas = termo
    ? salas.filter((s) => s.sala.includes(termo) || s.agentes.some((a) => a.toLowerCase().includes(termo))).slice(0, 6)
    : salas.slice(0, 8);
  const res = q.length >= 2 ? r : undefined;
  const nada = salasFiltradas.length === 0 && !(nova && !existe) && !!res
    && !res.mensagens.length && !res.tarefas.length && !res.artefatos.length && !res.fatos.length && !res.pessoas.length;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAberta(!aberta);
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberta, setAberta]);

  const ir = (d: Destino) => {
    setAberta(false);
    setBusca("");
    aoIr(d);
  };

  return (
    <CommandDialog open={aberta} onOpenChange={setAberta} title={t.titulo} description={t.descricao} className="sm:max-w-xl">
      {/* Filtro é nosso: salas no cliente, o resto já vem filtrado do servidor. */}
      <Command shouldFilter={false} className="motion-safe:animate-[paleta_150ms_cubic-bezier(.2,0,0,1)]">
        <CommandInput value={busca} onValueChange={setBusca} placeholder={t.placeholder} />
        <CommandList className="max-h-[min(60vh,28rem)]">
          <span className="sr-only" aria-live="polite">{isFetching ? t.buscando : ""}</span>
          {isFetching && <LoaderIcon aria-hidden className="absolute top-3.5 right-4 size-4 animate-spin text-muted-foreground" />}
          {nada && <CommandEmpty>{t.vazio}</CommandEmpty>}
          {salasFiltradas.length > 0 && (
            <CommandGroup heading={t.grupoSalas}>
              {salasFiltradas.map((s) => (
                <CommandItem key={s.sala} value={`sala:${s.sala}`} onSelect={() => ir({ tipo: "sala", sala: s.sala })}>
                  <HashIcon />
                  <span className="truncate">{s.sala}</span>
                  <CommandShortcut>{s.sala === salaAtual ? t.atual : s.mencoes ? `@${s.mencoes}` : s.nao_lidas || ""}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!res?.mensagens.length && (
            <CommandGroup heading={t.grupoMensagens}>
              {res.mensagens.map((m) => (
                <CommandItem key={m.id} value={`msg:${m.id}`} onSelect={() => ir({ tipo: "mensagem", sala: m.sala, id: m.id })}>
                  <MessageSquareIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-muted-foreground">#{m.sala} · {m.de}</span>
                    <span className="line-clamp-2"><Marcado texto={textoPlano(m.texto)} q={q} /></span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!res?.fatos.length && (
            <CommandGroup heading={t.grupoMemoria}>
              {res.fatos.map((f) => (
                <CommandItem key={f.id} value={`fato:${f.id}`} onSelect={() => ir({ tipo: "fato", sala: f.sala })}>
                  <BrainIcon />
                  <span className="min-w-0 flex-1 truncate"><Marcado texto={`${f.sujeito} ${f.predicado} ${f.objeto}`} q={q} /></span>
                  <CommandShortcut>#{f.sala}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!res?.tarefas.length && (
            <CommandGroup heading={t.grupoTarefas}>
              {res.tarefas.map((x) => (
                <CommandItem key={x.id} value={`tarefa:${x.id}`} onSelect={() => ir({ tipo: "tarefa", sala: x.sala, id: x.id })}>
                  <KanbanIcon />
                  <span className="min-w-0 flex-1 truncate">#{x.id} <Marcado texto={x.titulo} q={q} /></span>
                  <CommandShortcut>#{x.sala}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!res?.artefatos.length && (
            <CommandGroup heading={t.grupoArtefatos}>
              {res.artefatos.map((a) => (
                <CommandItem key={a.id} value={`artefato:${a.id}`} onSelect={() => ir({ tipo: "artefato", sala: a.sala, id: a.id })}>
                  <FileCodeIcon />
                  <span className="min-w-0 flex-1 truncate"><Marcado texto={a.titulo} q={q} /></span>
                  <CommandShortcut>{a.tipo}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!res?.pessoas.length && (
            <CommandGroup heading={t.grupoPessoas}>
              {res.pessoas.map((p) => (
                <CommandItem key={p.nome} value={`pessoa:${p.nome}`} onSelect={() => ir({ tipo: "pessoa", nome: p.nome })}>
                  <UserIcon />
                  <span className="truncate">{p.apelido ?? p.nome}</span>
                  {p.apelido && <CommandShortcut>{p.nome}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {nova && !existe && (
            <CommandGroup heading={t.grupoCriar}>
              <CommandItem value={`nova:${nova}`} onSelect={() => ir({ tipo: "sala", sala: nova })}>
                <PlusIcon />
                {t.criar(nova)}
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
