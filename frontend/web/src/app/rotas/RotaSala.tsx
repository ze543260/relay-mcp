import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

// cmdk + Dialog só quando a paleta abre pela primeira vez.
const Quadro = lazy(() => import("@/features/equipe/Quadro"));
const Memoria = lazy(() => import("@/features/memoria/Memoria"));
const Artefatos = lazy(() => import("@/features/artefatos/Artefatos"));
const PainelArtefato = lazy(() => import("@/features/artefatos/PainelArtefato"));
const PainelPerfil = lazy(() => import("@/features/perfil/PainelPerfil"));
const FaixaReuniao = lazy(() => import("@/features/equipe/FaixaReuniao").then((m) => ({ default: m.FaixaReuniao })));
const NovaReuniao = lazy(() => import("@/features/equipe/FaixaReuniao").then((m) => ({ default: m.NovaReuniao })));
const PaletaSalas = lazy(() => import("@/features/salas/PaletaSalas").then((m) => ({ default: m.PaletaSalas })));
const BuscaSala = lazy(() => import("@/features/busca/BuscaSala"));
import type { Destino } from "@/features/salas/PaletaSalas";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSessao } from "@/features/auth/sessao";
import { Composer } from "@/features/mensagens/Composer";
import { Conversa } from "@/features/mensagens/Conversa";
import { useConversa } from "@/features/mensagens/useConversa";
import { useAgentes } from "@/features/agentes/useAgentes";
import { useReunioes } from "@/features/equipe/api";
import { useDigitando, useLeituras, useMarcarLeitura } from "@/features/mensagens/presenca";
import { BrainIcon, CalendarPlusIcon, EllipsisVerticalIcon, FileCodeIcon, KanbanIcon, MessagesSquareIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Participantes } from "@/features/presenca/Participantes";
import { BarraLateral } from "@/features/salas/BarraLateral";
import type { Mensagem } from "@/shared/api/tipos";
import { useAvisos } from "@/shared/lib/avisos";
import { useTema } from "@/shared/lib/tema";
import { corDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { gravar, lerJson } from "@/shared/lib/armazenamento";
import { rotaSala } from "../router";
import { AbrirArtefatoContexto } from "@/features/artefatos/api";
import { AbrirPerfilContexto } from "@/features/perfil/api";

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
  const marcarLeitura = useMarcarLeitura(sala);
  const aoLer = useCallback((id: number) => {
    marcarLeitura(id);
    setVistas((v) => {
      if ((v[sala] ?? 0) >= id) return v;
      const prox = { ...v, [sala]: id };
      gravar("relay-vistas", JSON.stringify(prox));
      return prox;
    });
  }, [sala, marcarLeitura]);
  // Retrato do "já vi até aqui" no momento em que a sala abre (o divisor nasce dele).
  const [ultimaLida, setUltimaLida] = useState({ sala, id: vistas[sala] ?? 0 });
  if (ultimaLida.sala !== sala) setUltimaLida({ sala, id: vistas[sala] ?? 0 });

  const perderAcesso = useCallback(() => sair(textos.sessao.expirada), [sair]);
  const { tema, resolvido: temaResolvido, escolher: escolherTema } = useTema();
  const [paletaAberta, setPaletaAbertaEstado] = useState(false);
  const [paletaUsada, setPaletaUsada] = useState(false);
  const setPaletaAberta = useCallback((a: boolean) => { if (a) setPaletaUsada(true); setPaletaAbertaEstado(a); }, []);
  // Monta paleta e busca (fechadas) com a página já parada: o 1º Ctrl+K abre na hora e não perde o que se digita.
  useEffect(() => {
    const t = setTimeout(() => { setPaletaUsada(true); setBuscaSalaUsada(true); }, 4000);
    return () => clearTimeout(t);
  }, []);
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
  const aoEvento = useCallback((tipo: "tarefa" | "reuniao" | "leitura" | "apelido" | "fato" | "artefato") => {
    if (tipo === "artefato") {
      void qc.invalidateQueries({ queryKey: ["artefatos", sala] });
      return void qc.invalidateQueries({ queryKey: ["artefato"] });
    }
    if (tipo === "fato") {
      void qc.invalidateQueries({ queryKey: ["fatos", sala] });
      return void qc.invalidateQueries({ queryKey: ["candidatos", sala] });
    }
    if (tipo === "leitura") return void qc.invalidateQueries({ queryKey: ["leituras", sala] });
    if (tipo === "apelido") return void qc.invalidateQueries({ queryKey: ["agentes"] });
    void qc.invalidateQueries({ queryKey: [tipo === "tarefa" ? "tarefas" : "reunioes", sala] });
    if (tipo === "tarefa") {
      void qc.invalidateQueries({ queryKey: ["sprints", sala] });
      void qc.invalidateQueries({ queryKey: ["etiquetas", sala] });
      void qc.invalidateQueries({ queryKey: ["tarefa"] }); // painel aberto (o evento não diz qual tarefa)
    }
  }, [qc, sala]);
  const conversa = useConversa({ sala, ativo: logado, aoChegar, aoPerderAcesso: perderAcesso, aoEvento });
  // "relay" é o próprio sistema (eventos de tarefa/reunião), não um participante.
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))].filter((n) => n !== "relay");
  const { data: agentes } = useAgentes();
  const { data: leiturasLista } = useLeituras(sala);
  const leituras = useMemo(() => new Map((leiturasLista ?? []).filter((l) => l.nome !== nome).map((l) => [l.nome, l.ultimo_id])), [leiturasLista, nome]);
  const digitar = useDigitando(sala);
  const apelidos = useMemo(() => new Map((agentes ?? []).filter((a) => a.apelido).map((a) => [a.nome, a.apelido!])), [agentes]);
  const candidatos = useMemo(() => {
    const porNome = new Map((agentes ?? []).map((a) => [a.nome, a]));
    const nomes = new Set([...autores, ...(agentes ?? []).map((a) => a.nome)]);
    return [...nomes].map((n) => ({ nome: n, online: porNome.get(n)?.online ?? false, apelido: porNome.get(n)?.apelido }));
  }, [agentes, autores.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [aba, setAba] = useState<"conversa" | "quadro" | "memoria" | "artefatos">("conversa");
  const [artefatoAberto, setArtefatoAberto] = useState<number | null>(null);
  const abrirArtefato = useCallback((id: number) => setArtefatoAberto(id), []);
  const [perfilAberto, setPerfilAberto] = useState<string | null>(null);
  const abrirPerfil = useCallback((n: string) => { if (n !== "relay") setPerfilAberto(n); }, []);
  const [irPara, setIrPara] = useState<number | null>(null);
  const [tarefaPedida, setTarefaPedida] = useState<number | null>(null);
  const [buscaSala, setBuscaSala] = useState(false);
  const [buscaSalaUsada, setBuscaSalaUsada] = useState(false);
  const abrirBuscaSala = useCallback(() => { setBuscaSalaUsada(true); setBuscaSala(true); }, []);
  // Ctrl+Shift+F: busca na sala (Ctrl+F continua sendo o do navegador).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f" && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); abrirBuscaSala(); }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [abrirBuscaSala]);
  const [novaReuniao, setNovaReuniao] = useState(false);
  const { data: reunioes } = useReunioes(sala);
  const reuniaoAtiva = reunioes?.some((r) => r.estado !== "encerrada") ?? false;
  // Canal de reunião ("<sala>.reuniao-<id>"): cabeçalho com o título e volta para a sala de origem.
  const doCanal = reunioes?.find((r) => r.canal === sala);
  const te = textos.equipe;
  const ABAS = [["conversa", MessagesSquareIcon, te.conversa], ["quadro", KanbanIcon, te.quadro],
    ["memoria", BrainIcon, textos.memoria.aba], ["artefatos", FileCodeIcon, textos.artefatos.aba]] as const;

  if (estadoSessao === "fora") return <Navigate to="/entrar" search={{ volta: sala }} replace />;

  const escolher = (s: string) => void navegar({ to: "/s/$sala", params: { sala: s } });
  // Resultado do Ctrl+K: vai pra sala certa e abre a aba/painel do item.
  const aoIr = (d: Destino) => {
    if (d.tipo === "pessoa") return abrirPerfil(d.nome);
    if (d.sala !== sala) escolher(d.sala);
    if (d.tipo === "sala") return setAba("conversa");
    if (d.tipo === "mensagem") { setIrPara(d.id); setAba("conversa"); }
    else if (d.tipo === "tarefa") { setTarefaPedida(d.id); setAba("quadro"); }
    else if (d.tipo === "artefato") { setAba("artefatos"); abrirArtefato(d.id); }
    else setAba("memoria");
  };

  return (
    <AbrirArtefatoContexto.Provider value={abrirArtefato}>
    <AbrirPerfilContexto.Provider value={abrirPerfil}>
    <SidebarProvider className="h-dvh min-h-0">
      <BarraLateral sala={sala} nome={nome} admin={admin} vistas={vistas} estado={conversa.estado} tema={tema}
        aoEscolher={escolher} aoBuscar={() => setPaletaAberta(true)} aoTema={escolherTema}
        notificacoes={avisos.suportado ? { ativas: avisos.ativas, negadas: avisos.negadas, alternar: () => void avisos.alternar() } : null} aoSair={() => sair()} />
      {paletaUsada && (
        <Suspense fallback={null}>
          <PaletaSalas aberta={paletaAberta} setAberta={setPaletaAberta} salaAtual={sala} aoIr={aoIr} />
        </Suspense>
      )}
      {buscaSalaUsada && (
        <Suspense fallback={null}>
          <BuscaSala sala={sala} aberta={buscaSala} setAberta={setBuscaSala} aoIrPara={(id) => { setIrPara(id); setAba("conversa"); }} />
        </Suspense>
      )}
      <SidebarInset className="group/sala min-h-0 min-w-0">
        {/* Celular: uma linha só (menu, sala, tema, ⋯); abas vão pra barra de baixo. */}
        <header className="flex items-center gap-2 border-b px-4 pt-[calc(.5rem+env(safe-area-inset-top))] pb-2 md:gap-3 md:py-3">
          <SidebarTrigger className="-ml-2 size-11 md:-ml-1 md:size-8" aria-label={textos.salas.alternarLateral} />
          <span aria-hidden className="hidden h-4 w-px bg-border md:block" />
          {doCanal ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none">
              <Button variant="ghost" size="sm" className="px-1.5 text-muted-foreground" onClick={() => escolher(doCanal.sala)}
                aria-label={textos.reuniao.voltarSala(doCanal.sala)}>#{doCanal.sala}</Button>
              <span className="text-muted-foreground" aria-hidden>/</span>
              <h1 className="min-w-0 truncate text-base font-semibold">🗓 #{doCanal.id} {doCanal.titulo}</h1>
            </div>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:flex-none">#{sala}</h1>
          )}
          <div role="tablist" aria-label={te.abas} className="hidden rounded-lg bg-superficie p-0.5 md:flex">
            {ABAS.map(([id, Icone, rotulo]) => (
              <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={cn("flex min-h-7 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  aba === id ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                <Icone className="size-3.5" aria-hidden />{rotulo}
              </button>
            ))}
          </div>
          <div className="hidden xl:contents"><Participantes autores={autores} /></div>
          <Button variant="ghost" size="icon" className="ml-auto size-11 md:size-8 xl:ml-0" aria-label={textos.buscaSala.abrir(sala)}
            title={`${textos.buscaSala.abrir(sala)} (Ctrl Shift F)`} onClick={abrirBuscaSala}>
            <SearchIcon />
          </Button>
          {/* Tema à vista: um clique alterna claro/escuro ("Sistema" fica no menu do usuário). */}
          <Button variant="ghost" size="icon" className="size-11 md:size-8"
            aria-label={temaResolvido === "escuro" ? textos.tema.paraClaro : textos.tema.paraEscuro}
            title={temaResolvido === "escuro" ? textos.tema.paraClaro : textos.tema.paraEscuro}
            onClick={() => escolherTema(temaResolvido === "escuro" ? "claro" : "escuro")}>
            {temaResolvido === "escuro" ? <SunIcon /> : <MoonIcon />}
          </Button>
          {!reuniaoAtiva && !doCanal && (
            <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => setNovaReuniao(true)}>
              <CalendarPlusIcon /> {textos.reuniao.nova}
            </Button>
          )}
          {/* Celular e telas médias: participantes (e, no celular, reunião) no ⋯ */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="-mr-2 size-11 md:mr-0 md:size-8 xl:hidden" aria-label={te.maisOpcoes} />}>
              <EllipsisVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{te.online((agentes ?? []).filter((a) => a.online && a.nome !== "relay").length)}</DropdownMenuLabel>
                {(agentes ?? []).filter((a) => a.online && a.nome !== "relay").map((a) => (
                  <DropdownMenuItem key={a.nome} onClick={() => abrirPerfil(a.nome)}>
                    <i aria-hidden className="size-2 rounded-full" style={{ background: corDe(a.nome) }} />{a.apelido ?? a.nome}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              {!reuniaoAtiva && !doCanal && (
                <><DropdownMenuSeparator className="md:hidden" /><DropdownMenuItem className="md:hidden" onClick={() => setNovaReuniao(true)}><CalendarPlusIcon />{textos.reuniao.nova}</DropdownMenuItem></>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {reuniaoAtiva && <Suspense fallback={null}><FaixaReuniao sala={sala} eu={nome} admin={admin} /></Suspense>}
        {novaReuniao && (
          <Suspense fallback={null}>
            <NovaReuniao sala={sala} eu={nome} candidatos={candidatos} aberto={novaReuniao} setAberto={setNovaReuniao} />
          </Suspense>
        )}
        {aba === "artefatos" ? (
          <Suspense fallback={<div className="flex-1" />}><Artefatos sala={doCanal?.sala ?? sala} /></Suspense>
        ) : aba === "memoria" ? (
          <Suspense fallback={<div className="flex-1" />}>
            <Memoria sala={doCanal?.sala ?? sala} admin={admin} abrirMensagem={(id) => {
              if (doCanal) escolher(doCanal.sala);
              setIrPara(id); setAba("conversa");
            }} />
          </Suspense>
        ) : aba === "quadro" ? (
          <Suspense fallback={<div className="flex-1" />}><Quadro sala={doCanal?.sala ?? sala} eu={nome} admin={admin} abrir={tarefaPedida} /></Suspense>
        ) : (
          <>
            <Conversa key={sala} sala={sala} eu={nome} carregando={conversa.estado.tipo === "carregando"}
              ultimaLida={ultimaLida.id} aoLer={aoLer} admin={admin} aoResponder={setRespondendo} leituras={leituras} apelidos={apelidos} {...conversa}
              irPara={irPara} aoChegarEm={() => setIrPara(null)} aoIrPara={setIrPara} />
            <Composer key={`c-${sala}`} sala={sala} rotuloSala={doCanal ? `🗓 ${doCanal.titulo}` : undefined} nome={nome} respondendo={respondendo} candidatos={candidatos} aoCancelarResposta={() => setRespondendo(null)}
              aoEnviar={(texto, replyTo, anexos) => conversa.enviar(texto, nome, replyTo, anexos)}
              aoDigitar={(d) => (d ? digitar.avisar() : digitar.parar())} />
          </>
        )}
        {/* Celular: abas embaixo, como no app; somem enquanto se digita (o teclado já ocupa a tela). */}
        <nav aria-label={te.abas} className="flex border-t bg-card pb-[env(safe-area-inset-bottom)] group-has-[textarea:focus]/sala:hidden md:hidden">
          {ABAS.map(([id, Icone, rotulo]) => (
            <button key={id} type="button" aria-current={aba === id ? "page" : undefined} onClick={() => setAba(id)}
              className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
                aba === id ? "font-semibold text-primary" : "text-muted-foreground")}>
              <span className={cn("grid h-7 w-14 place-items-center rounded-full transition-colors", aba === id && "bg-acento-fundo")}>
                <Icone className="size-5" aria-hidden />
              </span>
              {rotulo}
            </button>
          ))}
        </nav>
      </SidebarInset>
      {/* Sempre montado (só alterna `open`): montar o Sheet no próprio clique fazia ele fechar na hora. */}
      <Suspense fallback={null}>
        <PainelArtefato id={artefatoAberto} admin={admin} fechar={() => setArtefatoAberto(null)} />
      </Suspense>
      <Suspense fallback={null}>
        <PainelPerfil nome={perfilAberto} sala={doCanal?.sala ?? sala} admin={admin} fechar={() => setPerfilAberto(null)} />
      </Suspense>
    </SidebarProvider>
    </AbrirPerfilContexto.Provider>
    </AbrirArtefatoContexto.Provider>
  );
}
