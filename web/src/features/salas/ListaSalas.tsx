import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/cliente";
import type { Sala } from "../../shared/api/tipos";

interface Props {
  atual: string;
  vistas: Record<string, number>;
  aoEscolher: (sala: string) => void;
}

export function useSalas() {
  return useQuery({
    queryKey: ["salas"],
    queryFn: ({ signal }) => api<Sala[]>("/salas", { sinal: signal }),
    refetchInterval: 60_000,
  });
}

export function ListaSalas({ atual, vistas, aoEscolher }: Props) {
  const { data = [] } = useSalas();
  const salas = data.some((s) => s.sala === atual) ? data : [{ sala: atual, total: 0, agentes: [] }, ...data];

  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Salas">
      {salas.map((s) => {
        const ativa = s.sala === atual;
        // Não lidas só quando o servidor manda ultimo_id (contrato novo).
        const naoLida = !ativa && s.ultimo_id !== undefined && s.ultimo_id > (vistas[s.sala] ?? 0);
        return (
          <button key={s.sala} onClick={() => aoEscolher(s.sala)} aria-current={ativa || undefined}
            className={`block min-h-13 w-full rounded-lg px-3 py-2.5 text-left hover:bg-fundo md:min-h-0 ${ativa ? "bg-acento-fundo hover:bg-acento-fundo" : ""}`}>
            <span className="flex justify-between font-medium">
              #{s.sala}
              <span className={naoLida ? "rounded-full bg-acento px-1.5 text-xs font-medium text-white" : "font-mono text-xs text-suave"}>
                {s.total}
              </span>
            </span>
            <span className="block truncate text-xs text-suave">{s.agentes.filter(Boolean).join(", ") || "vazia"}</span>
          </button>
        );
      })}
    </nav>
  );
}
