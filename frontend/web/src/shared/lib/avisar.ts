import { useSyncExternalStore } from "react";
import type { ExternalToast } from "sonner";

// Sonner fica fora do bundle inicial: o primeiro aviso monta o <Toaster/> e só então mostra.
let pedido = false;
let montado: () => void = () => undefined;
const pronto = new Promise<void>((ok) => { montado = ok; });
const ouvintes = new Set<() => void>();

export function avisar(tipo: "erro" | "sucesso", mensagem: string, opcoes?: ExternalToast): void {
  if (!pedido) {
    pedido = true;
    ouvintes.forEach((f) => f());
  }
  void Promise.all([import("sonner"), pronto]).then(([{ toast }]) =>
    tipo === "erro" ? toast.error(mensagem, opcoes) : toast.success(mensagem, opcoes));
}

/** Chamado pelo Toaster quando monta (libera os avisos em espera). */
export const toasterMontou = () => montado();

export function useToasterPedido(): boolean {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; }, () => pedido);
}
