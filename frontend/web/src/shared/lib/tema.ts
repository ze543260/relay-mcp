import { useCallback, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
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

/** Ponto de onde a troca de tema se espalha (centro do botão clicado). */
export type Origem = { x: number; y: number };

/**
 * Troca com View Transitions: a partir de `origem`, o tema novo cresce em círculo (450 ms);
 * sem origem, cross-fade. Sem suporte ou com "reduzir movimento", troca na hora.
 */
function comTransicao(trocar: () => void, origem?: Origem): void {
  const doc = document as Document & { startViewTransition?: (f: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return trocar();
  const raiz = document.documentElement;
  raiz.dataset.transicao = origem ? "circulo" : "fade";
  const vt = doc.startViewTransition(() => flushSync(trocar));
  vt.ready.then(() => {
    if (!origem) return;
    const { x, y } = origem;
    const raio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    raiz.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
      { duration: 450, easing: "cubic-bezier(.2,0,0,1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => {});
  void (vt as unknown as { finished: Promise<void> }).finished?.finally(() => { delete raiz.dataset.transicao; });
}

export function useTema() {
  const tema = useSyncExternalStore(assinar, () => atual);
  const sistemaEscuro = useSyncExternalStore(assinar, () => mq?.matches ?? false);
  const escolher = useCallback((novo: Tema, origem?: Origem) => {
    if (novo === atual) return;
    gravar(CHAVE, novo === "sistema" ? null : novo);
    comTransicao(() => {
      atual = novo;
      aplicar(novo);
      ouvintes.forEach((f) => f());
    }, origem);
  }, []);
  const resolvido: "claro" | "escuro" = tema === "sistema" ? (sistemaEscuro ? "escuro" : "claro") : tema;
  return { tema, resolvido, escolher };
}
