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
import type { Mensagem } from "@/shared/api/tipos";
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

  const aoChegar = useCallback((novas: Mensagem[]) => {
    const ultimo = novas.at(-1)?.id ?? 0;
    setVistas((v) => {
      const prox = { ...v, [sala]: Math.max(v[sala] ?? 0, ultimo) };
      gravar("relay-vistas", JSON.stringify(prox));
      return prox;
    });
    void qc.invalidateQueries({ queryKey: ["salas"] });
  }, [sala, qc]);

  const perderAcesso = useCallback(() => sair("Sessão expirada. Entre de novo."), [sair]);
  const conversa = useConversa({ sala, ativo: logado, aoChegar, aoPerderAcesso: perderAcesso });
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))];

  if (!logado) return <Navigate to="/entrar" search={{ volta: sala }} replace />;

  const escolher = (s: string) => void navegar({ to: "/s/$sala", params: { sala: s } });

  return (
    <SidebarProvider className="h-dvh min-h-0">
      <BarraLateral sala={sala} nome={nome} vistas={vistas} estado={conversa.estado} aoEscolher={escolher} aoSair={() => sair()} />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 pt-[calc(.5rem+env(safe-area-inset-top))] pb-2 md:flex-nowrap md:gap-3 md:py-3">
          <SidebarTrigger className="-ml-2 size-11 md:-ml-1 md:size-8" aria-label="Alternar lateral" />
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:flex-none">#{sala}</h1>
          <Participantes autores={autores} />
        </header>
        <Conversa key={sala} sala={sala} eu={nome} carregando={conversa.estado.tipo === "carregando"} {...conversa} />
        <Composer sala={sala} nome={nome} aoPerderAcesso={perderAcesso} />
      </SidebarInset>
    </SidebarProvider>
  );
}
