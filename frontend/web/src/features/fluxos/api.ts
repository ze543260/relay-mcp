import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import { avisar } from "@/shared/lib/avisar";
import type { DocFluxo, Layout } from "./grafo";

/** Item do catálogo: última versão de cada fluxo da sala. */
export interface ResumoFluxo {
  nome: string;
  versao: number;
  sha256: string;
  descricao: string | null;
  pior_caso: number;
  publicado_por: string;
  criado_em: string;
}

export interface FluxoPublicado {
  nome: string;
  versao: number;
  sha256: string;
  /** Forma canônica (JSON sem layout); o hash é dela. */
  conteudo: string;
  layout: Layout | null;
  publicado_por: string;
  criado_em: string;
  versoes: number[];
}

export type EstadoPedido = "pendente" | "aceito" | "recusado" | "concluido" | "falhou" | "cancelado" | "expirado";

export interface PedidoFluxo {
  id: number;
  sala: string;
  de: string;
  agente: string;
  nome: string;
  versao: number;
  expect_sha256: string | null;
  params: Record<string, unknown>;
  chain: string[];
  correlation_id: string;
  estado: EstadoPedido;
  resultado: Record<string, unknown> | null;
  motivo: string | null;
  criado_em: string;
  atualizado_em: string;
  expira_em: string;
}

export interface NovoPedido {
  sala: string;
  agente: string;
  nome: string;
  versao: number;
  params: Record<string, string | number | boolean | string[]>;
  expect_sha256?: string;
  prazo_s?: number;
}

export const useFluxos = (sala: string) => useQuery({
  queryKey: ["fluxos", sala],
  queryFn: ({ signal }) => api<ResumoFluxo[]>(`/fluxos?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export const useFluxo = (sala: string, nome: string | null, versao?: number) => useQuery({
  queryKey: ["fluxo", sala, nome, versao ?? "atual"],
  queryFn: ({ signal }) => {
    const q = new URLSearchParams({ sala });
    if (versao) q.set("versao", String(versao));
    return api<FluxoPublicado>(`/fluxos/${encodeURIComponent(nome!)}?${q}`, { sinal: signal });
  },
  enabled: nome !== null,
  placeholderData: (anterior) => anterior,
});

export const usePedidos = (sala: string) => useQuery({
  queryKey: ["pedidos", sala],
  queryFn: ({ signal }) => api<PedidoFluxo[]>(`/fluxos/pedidos?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export function useMexerFluxo() {
  const qc = useQueryClient();
  const erro = (e: unknown) => avisar("erro", traduzirErro(e).mensagem);
  return {
    publicar: useMutation({
      mutationFn: ({ sala, fluxo }: { sala: string; fluxo: DocFluxo }) =>
        api<{ nome: string; versao: number; sha256: string; pior_caso: number }>("/fluxos", { metodo: "POST", corpo: { sala, fluxo } }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["fluxos"] });
        void qc.invalidateQueries({ queryKey: ["fluxo"] });
      },
      // Erro de validação aparece no editor, não em toast.
    }),
    pedir: useMutation({
      mutationFn: (p: NovoPedido) => api<PedidoFluxo>("/fluxos/pedidos", { metodo: "POST", corpo: p }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedidos"] }),
      onError: erro,
    }),
    cancelar: useMutation({
      mutationFn: (id: number) => api<PedidoFluxo>(`/fluxos/pedidos/${id}/estado`, { metodo: "POST", corpo: { estado: "cancelado" } }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ["pedidos"] }),
      onError: erro,
    }),
  };
}
