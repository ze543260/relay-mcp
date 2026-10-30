import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/shared/api/cliente";
import type { EstadoStatus, ModoStatus, StatusPessoa } from "@/shared/api/tipos";

export interface MeuStatus extends StatusPessoa {
  nome: string;
  modo: ModoStatus;
}

/** Cor e forma do ponto (estilo Discord/Teams): online verde, ausente âmbar, ocupado vermelho, offline vazado. */
export const COR_ESTADO: Record<EstadoStatus, string> = {
  online: "var(--ok)",
  ausente: "var(--alerta, #c9871a)",
  ocupado: "var(--erro)",
  offline: "var(--suave)",
};

export function useMeuStatus(ativo: boolean) {
  return useQuery({
    queryKey: ["status", "eu"],
    queryFn: ({ signal }) => api<MeuStatus>("/status/eu", { sinal: signal }),
    enabled: ativo,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useDefinirStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { modo?: ModoStatus; texto?: string | null; emoji?: string | null; dura_s?: number | null }) =>
      api<MeuStatus>("/status", { metodo: "PUT", corpo }),
    onSuccess: (st) => {
      qc.setQueryData(["status", "eu"], st);
      void qc.invalidateQueries({ queryKey: ["agentes"] });
    },
  });
}

const OCIOSO_MS = 10 * 60_000;

/** Ausente automático: 10 min sem mexer (ou com a aba escondida) avisa o servidor; mexeu, volta. */
export function useOcioso(ativo: boolean) {
  const ocioso = useRef(false);
  useEffect(() => {
    if (!ativo) return;
    let timer: ReturnType<typeof setTimeout>;
    const avisar = (v: boolean) => {
      if (ocioso.current === v) return;
      ocioso.current = v;
      void api("/status/ocioso", { metodo: "PUT", corpo: { ocioso: v } }).catch(() => { ocioso.current = !v; });
    };
    const mexeu = () => {
      avisar(false);
      clearTimeout(timer);
      timer = setTimeout(() => avisar(true), OCIOSO_MS);
    };
    const visibilidade = () => { if (document.hidden) { clearTimeout(timer); timer = setTimeout(() => avisar(true), OCIOSO_MS); } else mexeu(); };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, mexeu, { passive: true }));
    document.addEventListener("visibilitychange", visibilidade);
    mexeu();
    return () => {
      clearTimeout(timer);
      eventos.forEach((e) => window.removeEventListener(e, mexeu));
      document.removeEventListener("visibilitychange", visibilidade);
    };
  }, [ativo]);
}
