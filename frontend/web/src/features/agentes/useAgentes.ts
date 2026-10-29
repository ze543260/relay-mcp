import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import type { Agente, AgenteCriado } from "@/shared/api/tipos";

export function useAgentes() {
  return useQuery({
    queryKey: ["agentes"],
    queryFn: ({ signal }) => api<Agente[]>("/agentes", { sinal: signal }),
    refetchInterval: 30_000,
  });
}

export function useCriarAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { nome: string; tipo: "ia" | "humano" }) =>
      api<AgenteCriado>("/agentes", { metodo: "POST", corpo: dados }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentes"] }),
  });
}

export function useRevogarAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nome: string) => api<void>(`/agentes/${encodeURIComponent(nome)}`, { metodo: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentes"] }),
  });
}
