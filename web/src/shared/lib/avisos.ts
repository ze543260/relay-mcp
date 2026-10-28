import { useCallback, useEffect, useRef, useState } from "react";
import type { Mensagem } from "@/shared/api/tipos";
import { gravar, ler } from "./armazenamento";
import { resumo } from "./formato";

const CHAVE = "relay-notificacoes";
const suportado = typeof window !== "undefined" && "Notification" in window;

/**
 * Aba em segundo plano: contador no título e notificação do sistema para
 * menção (@eu) ou mensagem privada para mim. Opt-in pelo menu do usuário.
 */
export function useAvisos(eu: string, sala: string) {
  const [ativas, setAtivas] = useState(() => suportado && Notification.permission === "granted" && ler(CHAVE) === "1");
  const naoVistas = useRef(0);

  const atualizarTitulo = useCallback(() => {
    document.title = `${naoVistas.current > 0 ? `(${naoVistas.current}) ` : ""}#${sala} · Relay`;
  }, [sala]);

  useEffect(() => {
    const aoVoltar = () => { if (!document.hidden) { naoVistas.current = 0; atualizarTitulo(); } };
    document.addEventListener("visibilitychange", aoVoltar);
    atualizarTitulo();
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [atualizarTitulo]);

  const aoChegar = useCallback((novas: Mensagem[]) => {
    if (!document.hidden) return;
    const deOutros = novas.filter((m) => m.de !== eu);
    if (!deOutros.length) return;
    naoVistas.current += deOutros.length;
    atualizarTitulo();
    if (!ativas) return;
    const mencao = new RegExp(`@${eu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    for (const m of deOutros.filter((x) => x.para === eu || mencao.test(x.texto))) {
      const n = new Notification(`${m.de}${m.para ? " (privado)" : ""} em #${sala}`, {
        body: resumo(m.texto, 160), tag: `relay-${m.id}`, icon: "/icone.svg",
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }, [eu, sala, ativas, atualizarTitulo]);

  const alternar = useCallback(async () => {
    if (!suportado) return;
    if (ativas) { setAtivas(false); gravar(CHAVE, null); return; }
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    const ok = p === "granted";
    setAtivas(ok);
    gravar(CHAVE, ok ? "1" : null);
  }, [ativas]);

  return { aoChegar, ativas, alternar, suportado, negadas: suportado && Notification.permission === "denied" };
}
