import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import { avisar } from "@/shared/lib/avisar";
import { traduzirErro } from "@/shared/api/erros";

export const STATUS = ["a_fazer", "fazendo", "revisao", "feito"] as const;
export type Status = (typeof STATUS)[number];

export interface Tarefa {
  id: number;
  sala: string;
  titulo: string;
  descricao: string | null;
  status: Status;
  responsavel: string | null;
  sprint_id: number | null;
  msg_id: number | null;
  criada_por: string;
  atualizado_em: string;
}

export interface Sprint {
  id: number;
  nome: string;
  objetivo: string | null;
  inicio_em: string;
  fim_em: string | null;
  ativa: boolean;
  total: number;
  feitas: number;
}

export type Formato = "daily" | "planejamento" | "revisao" | "livre";

export interface Reuniao {
  id: number;
  sala: string;
  titulo: string;
  formato: Formato;
  pauta: string[];
  participantes: string[];
  item: number;
  item_atual: string | null;
  vez: string | null;
  estado: "aberta" | "ata" | "encerrada";
  inicio_em: string;
  limite_em: string | null;
  ata: string | null;
  criada_por: string;
}

const erro = (e: unknown) => avisar("erro", traduzirErro(e).mensagem);

export const useTarefas = (sala: string) => useQuery({
  queryKey: ["tarefas", sala],
  queryFn: ({ signal }) => api<Tarefa[]>(`/tarefas?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export const useSprints = (sala: string) => useQuery({
  queryKey: ["sprints", sala],
  queryFn: ({ signal }) => api<Sprint[]>(`/sprints?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export const useReunioes = (sala: string) => useQuery({
  queryKey: ["reunioes", sala],
  queryFn: ({ signal }) => api<Reuniao[]>(`/reunioes?${new URLSearchParams({ sala })}`, { sinal: signal }),
  // O limite de tempo é conferido no servidor a cada leitura.
  refetchInterval: 30_000,
});

/** Mutations de equipe: o SSE invalida as listas, mas invalidamos já para resposta imediata. */
export function useEquipe(sala: string) {
  const qc = useQueryClient();
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["tarefas", sala] });
    void qc.invalidateQueries({ queryKey: ["sprints", sala] });
    void qc.invalidateQueries({ queryKey: ["reunioes", sala] });
  };
  const opcoes = { onSuccess: recarregar, onError: erro };
  return {
    criarTarefa: useMutation({ mutationFn: (d: { titulo: string; responsavel?: string; sprint_id?: number }) =>
      api<Tarefa>("/tarefas", { metodo: "POST", corpo: { sala, ...d } }), ...opcoes }),
    alterarTarefa: useMutation({ mutationFn: ({ id, ...d }: { id: number; status?: Status; responsavel?: string | null }) =>
      api<Tarefa>(`/tarefas/${id}`, { metodo: "PATCH", corpo: d }), ...opcoes }),
    apagarTarefa: useMutation({ mutationFn: (id: number) => api<void>(`/tarefas/${id}`, { metodo: "DELETE" }), ...opcoes }),
    criarSprint: useMutation({ mutationFn: (d: { nome: string; objetivo?: string; dias: number }) =>
      api<{ id: number }>("/sprints", { metodo: "POST", corpo: { sala, ...d } }), ...opcoes }),
    criarReuniao: useMutation({ mutationFn: (d: { titulo?: string; formato: Formato; participantes: string[]; minutos?: number }) =>
      api<Reuniao>("/reunioes", { metodo: "POST", corpo: { sala, ...d } }), ...opcoes }),
    passarVez: useMutation({ mutationFn: (id: number) => api<Reuniao>(`/reunioes/${id}/passar`, { metodo: "POST", corpo: {} }), ...opcoes }),
    encerrar: useMutation({ mutationFn: ({ id, ...d }: { id: number; ata: string; acoes: { titulo: string; responsavel?: string }[] }) =>
      api<Reuniao>(`/reunioes/${id}/encerrar`, { metodo: "POST", corpo: d }), ...opcoes }),
  };
}
