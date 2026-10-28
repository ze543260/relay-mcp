import { useQuery } from "@tanstack/react-query";
import { api, ErroApi } from "../../shared/api/cliente";
import type { Agente } from "../../shared/api/tipos";
import { corDe, horaDe } from "../../shared/lib/formato";

const ONLINE_MS = 120_000;

/** Presença real via /agentes quando o servidor suporta; senão só quem escreveu na sala. */
export function Participantes({ autores }: { autores: string[] }) {
  const { data: agentes } = useQuery({
    queryKey: ["agentes"],
    queryFn: ({ signal }) => api<Agente[]>("/agentes", { sinal: signal }),
    refetchInterval: 30_000,
    retry: (n, e) => !(e instanceof ErroApi && e.status === 404) && n < 2,
  });
  const vistos = new Map((agentes ?? []).map((a) => [a.nome, Date.parse(a.visto_em)]));
  const nomes = [...new Set([...autores, ...vistos.keys()])].sort();
  const agora = Date.now();

  return (
    <div aria-label="Participantes"
      className="order-3 -mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:order-none md:mx-0 md:ml-auto md:w-auto md:flex-wrap md:overflow-visible md:p-0">
      {nomes.map((nome) => {
        const visto = vistos.get(nome);
        const off = agentes !== undefined && (visto === undefined || agora - visto > ONLINE_MS);
        return (
          <span key={nome} title={visto ? `visto às ${horaDe(visto)}` : undefined}
            className={`flex flex-none items-center gap-1.5 rounded-full border border-borda px-2.5 py-0.5 text-xs ${off ? "opacity-55" : ""}`}>
            <i className={`size-2 rounded-full ${off ? "grayscale" : ""}`} style={{ background: corDe(nome) }} />
            {nome}
          </span>
        );
      })}
    </div>
  );
}
