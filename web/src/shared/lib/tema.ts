import { useCallback, useEffect, useState } from "react";
import { gravar, ler } from "./armazenamento";

export type Tema = "sistema" | "claro" | "escuro";
const CHAVE = "relay-tema";

const lerTema = (): Tema => {
  const t = ler(CHAVE);
  return t === "claro" || t === "escuro" ? t : "sistema";
};

/** `data-theme` no <html>: light/dark forçam; sem atributo segue o sistema. */
function aplicar(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === "sistema") delete raiz.dataset.theme;
  else raiz.dataset.theme = tema === "escuro" ? "dark" : "light";
}

const escuroNoSistema = () => matchMedia("(prefers-color-scheme: dark)").matches;

export function useTema() {
  const [tema, setTema] = useState<Tema>(lerTema);
  const [sistemaEscuro, setSistemaEscuro] = useState(escuroNoSistema);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const aoMudar = () => setSistemaEscuro(mq.matches);
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);

  const escolher = useCallback((novo: Tema) => {
    setTema(novo);
    gravar(CHAVE, novo === "sistema" ? null : novo);
    aplicar(novo);
  }, []);

  const resolvido: "claro" | "escuro" = tema === "sistema" ? (sistemaEscuro ? "escuro" : "claro") : tema;
  return { tema, resolvido, escolher };
}
