import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api, ErroApi } from "@/shared/api/cliente";
import type { Agente } from "@/shared/api/tipos";
import { corDe, horaDe } from "@/shared/lib/formato";

const ONLINE_MS = 120_000;

/** Presença real via /agentes quando o servidor suporta; senão só quem escreveu na sala. */
export function Participantes({ autores }: { autores: string[] }) {
  const { data: agentes, dataUpdatedAt } = useQuery({
    queryKey: ["agentes"],
    queryFn: ({ signal }) => api<Agente[]>("/agentes", { sinal: signal }),
    refetchInterval: 30_000,
    retry: (n, e) => !(e instanceof ErroApi && e.status === 404) && n < 2,
  });
  const vistos = new Map((agentes ?? []).map((a) => [a.nome, Date.parse(a.visto_em)]));
  const nomes = [...new Set([...autores, ...vistos.keys()])].sort();

  return (
    <div aria-label="Participantes"
      className="order-3 -mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:order-none md:mx-0 md:ml-auto md:w-auto md:flex-wrap md:overflow-visible md:p-0">
      {nomes.map((nome) => {
        const visto = vistos.get(nome);
        const off = agentes !== undefined && (visto === undefined || dataUpdatedAt - visto > ONLINE_MS);
        const chip = (
          <Badge variant="outline" className={cn("h-6 flex-none gap-1.5 font-normal", off && "opacity-55")}>
            <i className={cn("size-2 rounded-full", off && "grayscale")} style={{ background: corDe(nome) }} />
            {nome}
          </Badge>
        );
        if (visto === undefined) return <span key={nome}>{chip}</span>;
        return (
          <Tooltip key={nome}>
            <TooltipTrigger render={<span />}>{chip}</TooltipTrigger>
            <TooltipContent>{off ? `visto às ${horaDe(visto)}` : "online"}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
