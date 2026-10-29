import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext } from "react";
import { api } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import { avisar } from "@/shared/lib/avisar";

export interface Persona {
  equipe: string | null;
  papel: string | null;
  foco: string | null;
  tom: string | null;
  limites: string | null;
  editado_por?: string;
  editado_em?: string;
}

export interface Perfil {
  nome: string;
  apelido: string | null;
  tipo: "ia" | "humano";
  dono: string | null;
  online: boolean;
  visto_em: string | null;
  ultima_mensagem_em: string | null;
  salas: string[];
  persona: Persona | null;
  tarefas: { id: number; sala: string; titulo: string; status: string; prioridade: string }[];
  fatos_registrados: number;
  pode_editar: boolean;
  acesso?: { token_ativo: boolean; criado_em: string; revogado_em: string | null };
}

export interface Grafo {
  centro: string;
  centros: string[];
  nos: { nome: string; rotulo: string; aliases: string[]; fatos: number }[];
  arestas: { fato: number; de: string; predicado: string; para: string; folha: boolean; origem: { tipo: string; id: string }; autor: string }[];
  cortado: boolean;
}

/** Abre o perfil de alguém de qualquer lugar (nome na conversa, participantes, quadro, memória). */
export const AbrirPerfilContexto = createContext<(nome: string) => void>(() => {});

export const usePerfil = (nome: string | null) => useQuery({
  queryKey: ["perfil", nome],
  queryFn: ({ signal }) => api<Perfil>(`/agentes/${encodeURIComponent(nome!)}`, { sinal: signal }),
  enabled: nome !== null,
});

/** Vizinhança na memória: centro = agente (fatos sobre e de autoria dele) ou um assunto. */
export const useGrafo = (sala: string, centro: { agente: string } | { sujeito: string } | null) => useQuery({
  queryKey: ["grafo", sala, centro],
  queryFn: ({ signal }) => api<Grafo>(`/memoria/grafo?${new URLSearchParams({
    sala, profundidade: "1", ...("agente" in centro! ? { centro: `agente:${centro.agente}` } : { sujeito: centro!.sujeito }),
  })}`, { sinal: signal }),
  enabled: centro !== null,
  retry: false,
});

export function useEditarPerfil(nome: string) {
  const qc = useQueryClient();
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["perfil", nome] });
    void qc.invalidateQueries({ queryKey: ["agentes"] });
  };
  const erro = (e: unknown) => avisar("erro", traduzirErro(e).mensagem);
  return {
    persona: useMutation({
      mutationFn: (p: Omit<Persona, "editado_por" | "editado_em">) =>
        api<void>(`/agentes/${encodeURIComponent(nome)}/persona`, { metodo: "PUT", corpo: p }),
      onSuccess: () => { recarregar(); avisar("sucesso", "Ficha salva."); }, onError: erro,
    }),
    revogar: useMutation({
      mutationFn: () => api<void>(`/agentes/${encodeURIComponent(nome)}`, { metodo: "DELETE" }),
      onSuccess: () => { recarregar(); avisar("sucesso", "Token revogado."); }, onError: erro,
    }),
  };
}
