import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import type { Sala } from "@/shared/api/tipos";

export function useSalas() {
  return useQuery({
    queryKey: ["salas"],
    queryFn: ({ signal }) => api<Sala[]>("/salas", { sinal: signal }),
    refetchInterval: 60_000,
  });
}
