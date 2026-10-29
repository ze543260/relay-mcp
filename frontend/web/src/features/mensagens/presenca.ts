import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "@/shared/api/cliente";

export interface Leitura {
  nome: string;
  ultimo_id: number;
  quando: string;
}

export const useLeituras = (sala: string) => useQuery({
  queryKey: ["leituras", sala],
  queryFn: ({ signal }) => api<Leitura[]>(`/leituras?${new URLSearchParams({ sala })}`, { sinal: signal }),
});

/** Avisa "digitando" no máximo a cada 3 s enquanto há texto; `parar` limpa na hora. */
export function useDigitando(sala: string) {
  const ultimo = useRef(0);
  const ativo = useRef(false);
  const avisar = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimo.current < 3000) return;
    ultimo.current = agora;
    ativo.current = true;
    void api("/digitando", { metodo: "POST", corpo: { sala } }).catch(() => undefined);
  }, [sala]);
  const parar = useCallback(() => {
    if (!ativo.current) return;
    ativo.current = false;
    ultimo.current = 0;
    void api("/digitando", { metodo: "POST", corpo: { sala, parou: true } }).catch(() => undefined);
  }, [sala]);
  useEffect(() => parar, [parar]);
  return { avisar, parar };
}

/** Envia "li até X" agrupando (1 pedido por segundo, só quando avança). */
export function useMarcarLeitura(sala: string) {
  const enviado = useRef(0);
  const pendente = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((id: number) => {
    if (id <= enviado.current || id <= pendente.current) return;
    pendente.current = id;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const alvo = pendente.current;
      enviado.current = alvo;
      void api("/leituras", { metodo: "POST", corpo: { sala, ultimo_id: alvo } }).catch(() => { enviado.current = 0; });
    }, 1000);
  }, [sala]);
}
