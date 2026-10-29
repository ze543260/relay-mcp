import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext } from "react";
import { api } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import { avisar } from "@/shared/lib/avisar";

export type TipoArtefato = "markdown" | "mermaid" | "html" | "svg";
export type EstadoArtefato = "rascunho" | "aprovado" | "arquivado";

export interface Artefato {
  id: number;
  sala: string;
  titulo: string;
  tipo: TipoArtefato;
  versao: number;
  estado: EstadoArtefato;
  criado_por: string;
  criado_em: string;
  atualizado_em: string;
  msg_id: number | null;
  autor_versao?: string | null;
  resumo?: string | null;
}

export interface ArtefatoComConteudo extends Artefato {
  versao_vista: number;
  conteudo: string;
  versao_em: string;
}

export interface Versao {
  versao: number;
  resumo: string | null;
  autor: string;
  criado_em: string;
  tamanho: number;
}

/** Abre o painel de um artefato de qualquer lugar (cartão na conversa, aba Artefatos). */
export const AbrirArtefatoContexto = createContext<(id: number) => void>(() => {});

export const useArtefatos = (sala: string) => useQuery({
  queryKey: ["artefatos", sala],
  queryFn: ({ signal }) => api<Artefato[]>(`/artefatos?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export const useArtefato = (id: number | null, versao?: number) => useQuery({
  queryKey: ["artefato", id, versao ?? "atual"],
  queryFn: ({ signal }) => api<ArtefatoComConteudo>(`/artefatos/${id}${versao ? `?versao=${versao}` : ""}`, { sinal: signal }),
  enabled: id !== null,
  placeholderData: (anterior) => anterior,
});

export const useVersoes = (id: number | null) => useQuery({
  queryKey: ["artefato", id, "versoes"],
  queryFn: ({ signal }) => api<Versao[]>(`/artefatos/${id}/versoes`, { sinal: signal }),
  enabled: id !== null,
});

export function useMexerArtefato() {
  const qc = useQueryClient();
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["artefato"] });
    void qc.invalidateQueries({ queryKey: ["artefatos"] });
  };
  const erro = (e: unknown) => avisar("erro", traduzirErro(e).mensagem);
  return {
    salvar: useMutation({
      mutationFn: ({ id, ...d }: { id: number; conteudo: string; base: number; resumo?: string }) =>
        api<Artefato>(`/artefatos/${id}`, { metodo: "PUT", corpo: d }),
      onSuccess: recarregar, onError: erro,
    }),
    decidir: useMutation({
      mutationFn: ({ id, acao }: { id: number; acao: "aprovar" | "arquivar" }) =>
        api<Artefato>(`/artefatos/${id}/${acao}`, { metodo: "POST", corpo: {} }),
      onSuccess: recarregar, onError: erro,
    }),
  };
}
