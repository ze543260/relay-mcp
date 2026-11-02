import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import { avisar } from "@/shared/lib/avisar";

export type EstadoFato = "candidato" | "vigente" | "superado" | "rejeitado";

export interface Fato {
  id: number;
  sala: string;
  sujeito: string;
  predicado: string;
  objeto: string;
  origem: { tipo: "msg" | "ata" | "tarefa" | "arquivo"; id: string };
  estado: EstadoFato;
  supera: number | null;
  superado_por: number | null;
  autor: string;
  confirmado_por: string | null;
  criado_em: string;
}

/**
 * Assunto que parece um arquivo: nome com extensão (`spec-v2.pdf`) ou caminho (`docs/PLANO.md`), sem espaços.
 * A memória guarda texto livre; isso é só para desenhar e destacar.
 */
export const ehArquivo = (nome: string): boolean => /^[^\s]+\.[a-z0-9]{1,8}$/i.test(nome.trim()) || /^[^\s]*\/[^\s]+$/.test(nome.trim());

/** Máximo que o servidor devolve por consulta (/fatos limita em 50). */
export const LIMITE = 50;

export const useFatos = (sala: string, termo: string, historico: boolean) => useQuery({
  queryKey: ["fatos", sala, termo, historico],
  queryFn: ({ signal }) => api<Fato[]>(`/fatos?${new URLSearchParams({
    sala, limite: String(LIMITE), ...(termo ? { q: termo } : {}), ...(historico ? { historico: "1" } : {}),
  })}`, { sinal: signal }),
  placeholderData: (anterior) => anterior,
});

export const useCandidatos = (sala: string) => useQuery({
  queryKey: ["candidatos", sala],
  queryFn: ({ signal }) => api<Fato[]>(`/fatos/candidatos?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export function useDecidirFato(sala: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, acao }: { id: number; acao: "confirmar" | "rejeitar" }) =>
      api<Fato>(`/fatos/${id}/${acao}`, { metodo: "POST", corpo: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["candidatos", sala] });
      void qc.invalidateQueries({ queryKey: ["fatos", sala] });
    },
    onError: (e) => avisar("erro", traduzirErro(e).mensagem),
  });
}
