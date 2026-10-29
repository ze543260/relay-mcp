import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { AbrirPerfilContexto } from "@/features/perfil/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api, ErroApi } from "@/shared/api/cliente";
import type { Agente } from "@/shared/api/tipos";
import { corDe, horaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { PontoStatus } from "./PontoStatus";


/** Presença real via /agentes quando o servidor suporta; senão só quem escreveu na sala. */
export function Participantes({ autores }: { autores: string[] }) {
  const { data: agentes } = useQuery({
    queryKey: ["agentes"],
    queryFn: ({ signal }) => api<Agente[]>("/agentes", { sinal: signal }),
    refetchInterval: 30_000,
    retry: (n, e) => !(e instanceof ErroApi && e.status === 404) && n < 2,
  });
  const porNome = new Map((agentes ?? []).map((a) => [a.nome, a]));
  const abrirPerfil = useContext(AbrirPerfilContexto);
  // Na sala: quem escreveu nela + quem está online agora.
  const nomes = [...new Set([...autores, ...(agentes ?? []).filter((a) => a.online).map((a) => a.nome)])].sort();

  return (
    <div aria-label={textos.conversa.participantes}
      className="order-3 -mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:order-none md:mx-0 md:ml-auto md:w-auto md:flex-wrap md:overflow-visible md:p-0">
      {nomes.map((nome) => {
        const a = porNome.get(nome);
        const visto = a?.visto_em ? Date.parse(a.visto_em) : undefined;
        const off = agentes !== undefined && !a?.online;
        const st = a?.status;
        const atividade = st?.atividade ? textos.status.atividades[st.atividade] : null;
        const chip = (
          <Badge variant="outline" className={cn("h-6 flex-none gap-1.5 font-normal", off && "border-dashed text-muted-foreground")}>
            {st ? <PontoStatus estado={st.estado} comRotulo={false} className="size-2 ring-0" />
              : <i className={cn("size-2 rounded-full", off && "grayscale")} style={{ background: corDe(nome) }} />}
            {porNome.get(nome)?.apelido ?? nome}
            {(st?.emoji || atividade) && <span className="text-muted-foreground">{st?.emoji ?? ""}{atividade ? ` ${atividade}` : ""}</span>}
          </Badge>
        );
        // Dica: estado + mensagem de status ("Não perturbe · 📅 Em reunião"), ou o visto por último.
        const dica = st && st.estado !== "offline"
          ? [textos.status.estados[st.estado], atividade, [st.emoji, st.texto].filter(Boolean).join(" ")].filter(Boolean).join(" · ")
          : visto === undefined ? undefined : off ? textos.conversa.vistoAs(horaDe(visto)) : textos.conversa.online;
        return (
          <button key={nome} type="button" title={dica} onClick={() => abrirPerfil(nome)} aria-label={textos.perfil.abrir(porNome.get(nome)?.apelido ?? nome)}
            className="flex-none rounded-full focus-visible:outline-2 focus-visible:outline-ring">{chip}</button>
        );
      })}
    </div>
  );
}
