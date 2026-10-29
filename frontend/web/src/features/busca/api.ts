import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/shared/api/cliente";
import type { Mensagem } from "@/shared/api/tipos";

export interface ResultadoBusca {
  salas: string[];
  pessoas: { nome: string; apelido: string | null }[];
  tarefas: { id: number; sala: string; titulo: string; status: string }[];
  artefatos: { id: number; sala: string; titulo: string; tipo: string }[];
  fatos: { id: number; sala: string; sujeito: string; predicado: string; objeto: string }[];
  mensagens: { id: number; sala: string; de: string; texto: string; criado_em: string }[];
}

/** Espera a pessoa parar de digitar antes de ir ao servidor. */
export function useAtrasado<T>(valor: T, ms = 200): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Ctrl+K: um pouco de tudo (rota /busca). Menos de 2 letras não busca. */
export function useBusca(q: string) {
  const termo = useAtrasado(q.trim());
  return useQuery({
    queryKey: ["busca", termo],
    queryFn: ({ signal }) => api<ResultadoBusca>(`/busca?q=${encodeURIComponent(termo)}&limite=5`, { sinal: signal }),
    enabled: termo.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Busca dentro de uma sala (rota /mensagens/busca), da mais recente. */
export function useBuscaSala(sala: string, q: string) {
  const termo = useAtrasado(q.trim());
  return useQuery({
    queryKey: ["busca-sala", sala, termo],
    queryFn: ({ signal }) => api<{ mensagens: Mensagem[]; tem_mais: boolean }>(
      `/mensagens/busca?sala=${encodeURIComponent(sala)}&q=${encodeURIComponent(termo)}&limite=30`, { sinal: signal }),
    enabled: termo.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Partes do texto com os termos buscados marcados (sem regex vinda do usuário). */
export function marcar(texto: string, q: string): { t: string; achou: boolean }[] {
  const termos = q.toLowerCase().split(/\s+/).filter((x) => x.length >= 2);
  if (!termos.length) return [{ t: texto, achou: false }];
  const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Caractere a caractere, pra os índices baterem com o texto original.
  const base = texto.split("").map((c) => semAcento(c).charAt(0) || c).join("");
  const marcas = new Array<boolean>(texto.length).fill(false);
  for (const termo of termos.map(semAcento)) {
    for (let i = base.indexOf(termo); i >= 0; i = base.indexOf(termo, i + 1)) {
      // Só no começo de palavra, como o prefixo do FTS.
      if (i > 0 && /[\p{L}\p{N}]/u.test(base.charAt(i - 1))) continue;
      for (let j = i; j < i + termo.length && j < marcas.length; j++) marcas[j] = true;
    }
  }
  const partes: { t: string; achou: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ultima = partes[partes.length - 1];
    if (ultima && ultima.achou === !!marcas[i]) ultima.t += texto.charAt(i);
    else partes.push({ t: texto.charAt(i), achou: !!marcas[i] });
  }
  return partes;
}

/** Texto de mensagem sem a sintaxe do Markdown, pra listas de resultado. */
export const textoPlano = (s: string) =>
  s.replace(/```[\s\S]*?```/g, " … ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~|]+/g, "").replace(/\s+/g, " ").trim();
