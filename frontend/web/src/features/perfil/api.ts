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
  foto?: number | null;
  pode_trocar_foto?: boolean;
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
    foto: useMutation({
      mutationFn: async (arquivo: File | null) => arquivo
        ? api<{ foto: number }>(`/agentes/${encodeURIComponent(nome)}/foto`, { metodo: "PUT", corpo: { dados: await fotoQuadrada(arquivo) } })
        : api<void>(`/agentes/${encodeURIComponent(nome)}/foto`, { metodo: "DELETE" }),
      onSuccess: (_r, arquivo) => { recarregar(); avisar("sucesso", arquivo ? "Foto trocada." : "Foto removida."); }, onError: erro,
    }),
    revogar: useMutation({
      mutationFn: () => api<void>(`/agentes/${encodeURIComponent(nome)}`, { metodo: "DELETE" }),
      onSuccess: () => { recarregar(); avisar("sucesso", "Token revogado."); }, onError: erro,
    }),
  };
}

/** Recorta no centro e reduz pra 256px em WebP: foto de perfil leve (~10 KB) vinda de qualquer imagem. */
async function fotoQuadrada(arquivo: File): Promise<string> {
  const img = await createImageBitmap(arquivo);
  const lado = Math.min(img.width, img.height);
  const tela = new OffscreenCanvas(256, 256);
  const ctx = tela.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  img.close();
  const blob = await tela.convertToBlob({ type: "image/webp", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
