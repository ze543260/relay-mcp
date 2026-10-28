import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

// cmdk + Dialog só quando a paleta abre pela primeira vez.
const PaletaSalas = lazy(() => import("@/features/salas/PaletaSalas").then((m) => ({ default: m.PaletaSalas })));
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSessao } from "@/features/auth/sessao";
import { Composer } from "@/features/mensagens/Composer";
import { Conversa } from "@/features/mensagens/Conversa";
import { useConversa } from "@/features/mensagens/useConversa";
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
  const conversa = useConversa({ sala, ativo: logado, aoChegar, aoPerderAcesso: perderAcesso });
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))];

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
          <Participantes autores={autores} />
        </header>
        <Conversa key={sala} sala={sala} eu={nome} carregando={conversa.estado.tipo === "carregando"}
          ultimaLida={ultimaLida.id} aoLer={aoLer} admin={admin} aoResponder={setRespondendo} {...conversa} />
        <Composer key={`c-${sala}`} sala={sala} nome={nome} respondendo={respondendo} aoCancelarResposta={() => setRespondendo(null)}
          aoEnviar={(texto, replyTo) => conversa.enviar(texto, nome, replyTo)} />
      </SidebarInset>
    </SidebarProvider>
  );
}
