import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import type { Sala } from "@/shared/api/tipos";

export function useSalas() {
  return useQuery({
    queryKey: ["salas"],
    queryFn: ({ signal }) => api<Sala[]>("/salas", { sinal: signal }),
    // As outras salas não chegam pelo SSE da sala aberta: os selos se atualizam por aqui.
    refetchInterval: 20_000,
  });
}
