import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

// cmdk + Dialog só quando a paleta abre pela primeira vez.
const Quadro = lazy(() => import("@/features/equipe/Quadro"));
const FaixaReuniao = lazy(() => import("@/features/equipe/FaixaReuniao").then((m) => ({ default: m.FaixaReuniao })));
const NovaReuniao = lazy(() => import("@/features/equipe/FaixaReuniao").then((m) => ({ default: m.NovaReuniao })));
const PaletaSalas = lazy(() => import("@/features/salas/PaletaSalas").then((m) => ({ default: m.PaletaSalas })));
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSessao } from "@/features/auth/sessao";
import { Composer } from "@/features/mensagens/Composer";
import { Conversa } from "@/features/mensagens/Conversa";
import { useConversa } from "@/features/mensagens/useConversa";
import { useAgentes } from "@/features/agentes/useAgentes";
import { useReunioes } from "@/features/equipe/api";
import { CalendarPlusIcon, KanbanIcon, MessagesSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Participantes } from "@/features/presenca/Participantes";
import { BarraLateral } from "@/features/salas/BarraLateral";
import type { Mensagem } from "@/shared/api/tipos";
import { useAvisos } from "@/shared/lib/avisos";
import { useTema } from "@/shared/lib/tema";
import { textos } from "@/shared/lib/textos";
import { gravar, lerJson } from "@/shared/lib/armazenamento";
import { rotaSala } from "../router";

export function RotaSala() {
  const { sala } = rotaSala.useParams();
  const { nome, admin, estado: estadoSessao, logado, sair } = useSessao();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [vistas, setVistas] = useState<Record<string, number>>(() => lerJson("relay-vistas", {}));

  useEffect(() => { gravar("relay-sala", sala); }, [sala]);

  const avisos = useAvisos(nome, sala);
  // Chegar não é ler: só atualiza contagens (e avisa se a aba está escondida). "Lida" vem da Conversa.
  const avisar = avisos.aoChegar;
  const aoChegar = useCallback((novas: Mensagem[]) => {
    void qc.invalidateQueries({ queryKey: ["salas"] });
    avisar(novas);
  }, [qc, avisar]);
  const aoLer = useCallback((id: number) => {
    setVistas((v) => {
      if ((v[sala] ?? 0) >= id) return v;
      const prox = { ...v, [sala]: id };
      gravar("relay-vistas", JSON.stringify(prox));
      return prox;
    });
  }, [sala]);
  // Retrato do "já vi até aqui" no momento em que a sala abre (o divisor nasce dele).
  const [ultimaLida, setUltimaLida] = useState({ sala, id: vistas[sala] ?? 0 });
  if (ultimaLida.sala !== sala) setUltimaLida({ sala, id: vistas[sala] ?? 0 });

  const perderAcesso = useCallback(() => sair(textos.sessao.expirada), [sair]);
  const { tema, escolher: escolherTema } = useTema();
  const [paletaAberta, setPaletaAbertaEstado] = useState(false);
  const [paletaUsada, setPaletaUsada] = useState(false);
  const setPaletaAberta = useCallback((a: boolean) => { if (a) setPaletaUsada(true); setPaletaAbertaEstado(a); }, []);
  // O atalho precisa existir antes da paleta carregar.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !paletaUsada) {
        e.preventDefault();
        setPaletaAberta(true);
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [paletaUsada, setPaletaAberta]);
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null);
  // Tarefas e reuniões mudaram (SSE): recarrega só o que for daquela sala.
  const aoEvento = useCallback((tipo: "tarefa" | "reuniao") => {
    void qc.invalidateQueries({ queryKey: [tipo === "tarefa" ? "tarefas" : "reunioes", sala] });
    if (tipo === "tarefa") void qc.invalidateQueries({ queryKey: ["sprints", sala] });
  }, [qc, sala]);
  const conversa = useConversa({ sala, ativo: logado, aoChegar, aoPerderAcesso: perderAcesso, aoEvento });
  // "relay" é o próprio sistema (eventos de tarefa/reunião), não um participante.
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))].filter((n) => n !== "relay");
  const { data: agentes } = useAgentes();
  const candidatos = useMemo(() => {
    const online = new Map((agentes ?? []).map((a) => [a.nome, a.online]));
    const nomes = new Set([...autores, ...(agentes ?? []).map((a) => a.nome)]);
    return [...nomes].map((n) => ({ nome: n, online: online.get(n) ?? false }));
  }, [agentes, autores.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [aba, setAba] = useState<"conversa" | "quadro">("conversa");
  const [novaReuniao, setNovaReuniao] = useState(false);
  const { data: reunioes } = useReunioes(sala);
  const reuniaoAtiva = reunioes?.some((r) => r.estado !== "encerrada") ?? false;
  const te = textos.equipe;

  if (estadoSessao === "fora") return <Navigate to="/entrar" search={{ volta: sala }} replace />;

  const escolher = (s: string) => void navegar({ to: "/s/$sala", params: { sala: s } });

  return (
    <SidebarProvider className="h-dvh min-h-0">
      <BarraLateral sala={sala} nome={nome} admin={admin} vistas={vistas} estado={conversa.estado} tema={tema}
        aoEscolher={escolher} aoBuscar={() => setPaletaAberta(true)} aoTema={escolherTema}
        notificacoes={avisos.suportado ? { ativas: avisos.ativas, negadas: avisos.negadas, alternar: () => void avisos.alternar() } : null} aoSair={() => sair()} />
      {paletaUsada && (
        <Suspense fallback={null}>
          <PaletaSalas aberta={paletaAberta} setAberta={setPaletaAberta} salaAtual={sala} aoEscolher={escolher} />
        </Suspense>
      )}
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 pt-[calc(.5rem+env(safe-area-inset-top))] pb-2 md:flex-nowrap md:gap-3 md:py-3">
          <SidebarTrigger className="-ml-2 size-11 md:-ml-1 md:size-8" aria-label={textos.salas.alternarLateral} />
          <span aria-hidden className="hidden h-4 w-px bg-border md:block" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:flex-none">#{sala}</h1>
          <div role="tablist" aria-label={te.conversa} className="order-2 flex rounded-lg bg-superficie p-0.5 md:order-none">
            {([["conversa", MessagesSquareIcon, te.conversa], ["quadro", KanbanIcon, te.quadro]] as const).map(([id, Icone, rotulo]) => (
              <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={cn("flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors md:min-h-7",
                  aba === id ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                <Icone className="size-3.5" aria-hidden />{rotulo}
              </button>
            ))}
          </div>
          <Participantes autores={autores} />
          {!reuniaoAtiva && (
            <Button variant="outline" size="sm" className="order-2 md:order-none" onClick={() => setNovaReuniao(true)}>
              <CalendarPlusIcon /> {textos.reuniao.nova}
            </Button>
          )}
        </header>
        {reuniaoAtiva && <Suspense fallback={null}><FaixaReuniao sala={sala} eu={nome} admin={admin} /></Suspense>}
        {novaReuniao && (
          <Suspense fallback={null}>
            <NovaReuniao sala={sala} eu={nome} candidatos={candidatos} aberto={novaReuniao} setAberto={setNovaReuniao} />
          </Suspense>
        )}
        {aba === "quadro" ? (
          <Suspense fallback={<div className="flex-1" />}><Quadro sala={sala} eu={nome} admin={admin} /></Suspense>
        ) : (
          <>
            <Conversa key={sala} sala={sala} eu={nome} carregando={conversa.estado.tipo === "carregando"}
              ultimaLida={ultimaLida.id} aoLer={aoLer} admin={admin} aoResponder={setRespondendo} {...conversa} />
            <Composer key={`c-${sala}`} sala={sala} nome={nome} respondendo={respondendo} candidatos={candidatos} aoCancelarResposta={() => setRespondendo(null)}
              aoEnviar={(texto, replyTo) => conversa.enviar(texto, nome, replyTo)} />
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
