import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/cliente";
import { avisar } from "@/shared/lib/avisar";
import { traduzirErro } from "@/shared/api/erros";

export const STATUS = ["a_fazer", "fazendo", "revisao", "feito"] as const;
export type Status = (typeof STATUS)[number];
/** Na ordem da fila (o servidor ordena igual). */
export const PRIORIDADES = ["urgente", "alta", "media", "baixa", "nenhuma"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];
export const ESTIMATIVAS = [1, 2, 3, 5, 8] as const;

export interface Etiqueta {
  id: number;
  nome: string;
  /** Índice 0–7 nos tokens --agente-N. */
  cor: number;
}

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
  criado_em: string;
  atualizado_em: string;
  prazo: string | null;
  prioridade: Prioridade;
  estimativa: number | null;
  ordem: number | null;
  etiquetas: Etiqueta[];
  checklist: { feitos: number; total: number };
}

export interface ItemChecklist {
  id: number;
  texto: string;
  feito: boolean;
  ordem: number;
}

export interface Atividade {
  de: string;
  campo: string;
  antes: string | null;
  depois: string | null;
  quando: string;
}

/** `GET /tarefas/{id}`: a tarefa com os itens do checklist e as últimas mudanças. */
export interface TarefaCompleta extends Tarefa {
  itens: ItemChecklist[];
  atividade: Atividade[];
}

/** Campos que o PATCH aceita; `etiquetas` substitui a lista inteira (por nome). */
export type EdicaoTarefa = Partial<Pick<Tarefa, "titulo" | "descricao" | "status" | "responsavel" | "prioridade" | "estimativa" | "prazo">>
  & { etiquetas?: string[] };

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
  /** Sala própria da reunião (falas e vez); a sala principal recebe convite e ata. */
  canal: string;
}

const erro = (e: unknown) => avisar("erro", traduzirErro(e).mensagem);

export const useTarefas = (sala: string) => useQuery({
  queryKey: ["tarefas", sala],
  queryFn: ({ signal }) => api<Tarefa[]>(`/tarefas?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

export const useTarefa = (id: number | null) => useQuery({
  queryKey: ["tarefa", id],
  queryFn: ({ signal }) => api<TarefaCompleta>(`/tarefas/${id}`, { sinal: signal }),
  enabled: id !== null,
});

export const useEtiquetas = (sala: string) => useQuery({
  queryKey: ["etiquetas", sala],
  queryFn: ({ signal }) => api<(Etiqueta & { tarefas: number })[]>(`/etiquetas?${new URLSearchParams({ sala })}`, { sinal: signal }),
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
    void qc.invalidateQueries({ queryKey: ["etiquetas", sala] });
  };
  const opcoes = { onSuccess: recarregar, onError: erro };
  // As rotas de tarefa devolvem a tarefa completa: já serve de cache do painel.
  const completa = { onSuccess: (t: TarefaCompleta) => { qc.setQueryData(["tarefa", t.id], t); recarregar(); }, onError: erro };
  return {
    criarTarefa: useMutation({ mutationFn: (d: { titulo: string; responsavel?: string; sprint_id?: number }) =>
      api<TarefaCompleta>("/tarefas", { metodo: "POST", corpo: { sala, ...d } }), ...completa }),
    alterarTarefa: useMutation({ mutationFn: ({ id, ...d }: { id: number } & EdicaoTarefa) =>
      api<TarefaCompleta>(`/tarefas/${id}`, { metodo: "PATCH", corpo: d }), ...completa }),
    apagarTarefa: useMutation({ mutationFn: (id: number) => api<void>(`/tarefas/${id}`, { metodo: "DELETE" }), ...opcoes }),
    criarItem: useMutation({ mutationFn: ({ id, texto }: { id: number; texto: string }) =>
      api<TarefaCompleta>(`/tarefas/${id}/checklist`, { metodo: "POST", corpo: { texto } }), ...completa }),
    alterarItem: useMutation({ mutationFn: ({ id, item, ...d }: { id: number; item: number; feito?: boolean; texto?: string }) =>
      api<TarefaCompleta>(`/tarefas/${id}/checklist/${item}`, { metodo: "PATCH", corpo: d }), ...completa }),
    apagarItem: useMutation({ mutationFn: ({ id, item }: { id: number; item: number }) =>
      api<TarefaCompleta>(`/tarefas/${id}/checklist/${item}`, { metodo: "DELETE" }), ...completa }),
    criarSprint: useMutation({ mutationFn: (d: { nome: string; objetivo?: string; dias: number }) =>
      api<{ id: number }>("/sprints", { metodo: "POST", corpo: { sala, ...d } }), ...opcoes }),
    criarReuniao: useMutation({ mutationFn: (d: { titulo?: string; formato: Formato; participantes: string[]; minutos?: number }) =>
      api<Reuniao>("/reunioes", { metodo: "POST", corpo: { sala, ...d } }), ...opcoes }),
    passarVez: useMutation({ mutationFn: (id: number) => api<Reuniao>(`/reunioes/${id}/passar`, { metodo: "POST", corpo: {} }), ...opcoes }),
    encerrar: useMutation({ mutationFn: ({ id, ...d }: { id: number; ata: string; acoes: { titulo: string; responsavel?: string }[] }) =>
      api<Reuniao>(`/reunioes/${id}/encerrar`, { metodo: "POST", corpo: d }), ...opcoes }),
  };
}
