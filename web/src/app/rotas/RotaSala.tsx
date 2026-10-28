import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSessao } from "@/features/auth/sessao";
import { Composer } from "@/features/mensagens/Composer";
import { Conversa } from "@/features/mensagens/Conversa";
import { useConversa } from "@/features/mensagens/useConversa";
import { Participantes } from "@/features/presenca/Participantes";
import { BarraLateral } from "@/features/salas/BarraLateral";
import { PaletaSalas } from "@/features/salas/PaletaSalas";
import { useTema } from "@/shared/lib/tema";
import { textos } from "@/shared/lib/textos";
import { gravar, lerJson } from "@/shared/lib/armazenamento";
import { rotaSala } from "../router";

export function RotaSala() {
  const { sala } = rotaSala.useParams();
  const { nome, logado, sair } = useSessao();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [vistas, setVistas] = useState<Record<string, number>>(() => lerJson("relay-vistas", {}));

  useEffect(() => {
    gravar("relay-sala", sala);
    document.title = `#${sala} · Relay`;
  }, [sala]);

  // Chegar não é ler: só atualiza contagens. "Lida" vem da Conversa (aoLer).
  const aoChegar = useCallback(() => void qc.invalidateQueries({ queryKey: ["salas"] }), [qc]);
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
  const [paletaAberta, setPaletaAberta] = useState(false);
  const conversa = useConversa({ sala, ativo: logado, aoChegar, aoPerderAcesso: perderAcesso });
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))];

  if (!logado) return <Navigate to="/entrar" search={{ volta: sala }} replace />;

  const escolher = (s: string) => void navegar({ to: "/s/$sala", params: { sala: s } });

  return (
    <SidebarProvider className="h-dvh min-h-0">
      <BarraLateral sala={sala} nome={nome} vistas={vistas} estado={conversa.estado} tema={tema}
        aoEscolher={escolher} aoBuscar={() => setPaletaAberta(true)} aoTema={escolherTema} aoSair={() => sair()} />
      <PaletaSalas aberta={paletaAberta} setAberta={setPaletaAberta} salaAtual={sala} aoEscolher={escolher} />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 pt-[calc(.5rem+env(safe-area-inset-top))] pb-2 md:flex-nowrap md:gap-3 md:py-3">
          <SidebarTrigger className="-ml-2 size-11 md:-ml-1 md:size-8" aria-label={textos.salas.alternarLateral} />
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:flex-none">#{sala}</h1>
          <Participantes autores={autores} />
        </header>
        <Conversa key={sala} sala={sala} eu={nome} carregando={conversa.estado.tipo === "carregando"}
          ultimaLida={ultimaLida.id} aoLer={aoLer} {...conversa} />
        <Composer sala={sala} nome={nome} aoEnviar={(texto) => conversa.enviar(texto, nome)} />
      </SidebarInset>
    </SidebarProvider>
  );
}
