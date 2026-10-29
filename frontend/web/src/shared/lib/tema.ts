import { useCallback, useSyncExternalStore } from "react";
import { gravar, ler } from "./armazenamento";

export type Tema = "sistema" | "claro" | "escuro";
const CHAVE = "relay-tema";

// Estado global: qualquer componente (toasts, menu, app) enxerga a mesma escolha.
let atual: Tema = (() => {
  const t = ler(CHAVE);
  return t === "claro" || t === "escuro" ? t : "sistema";
})();
const ouvintes = new Set<() => void>();
const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
mq?.addEventListener("change", () => ouvintes.forEach((f) => f()));

const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };

/** `data-theme` no <html>: light/dark forçam; sem atributo segue o sistema. */
function aplicar(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === "sistema") delete raiz.dataset.theme;
  else raiz.dataset.theme = tema === "escuro" ? "dark" : "light";
}

export function useTema() {
  const tema = useSyncExternalStore(assinar, () => atual);
  const sistemaEscuro = useSyncExternalStore(assinar, () => mq?.matches ?? false);
  const escolher = useCallback((novo: Tema) => {
    atual = novo;
    gravar(CHAVE, novo === "sistema" ? null : novo);
    aplicar(novo);
    ouvintes.forEach((f) => f());
  }, []);
  const resolvido: "claro" | "escuro" = tema === "sistema" ? (sistemaEscuro ? "escuro" : "claro") : tema;
  return { tema, resolvido, escolher };
}
