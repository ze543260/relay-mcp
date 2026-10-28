import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ehAbort, ErroApi, listaDe } from "@/shared/api/cliente";
import type { Mensagem, PaginaHistorico, RespostaMensagens } from "@/shared/api/tipos";

export type EstadoConexao =
  | { tipo: "carregando" }
  | { tipo: "ao-vivo" }
  | { tipo: "reconectando"; emSegundos: number }
  | { tipo: "sem-acesso" };

interface Opcoes {
  sala: string;
  /** Falso enquanto não há sessão: nada é buscado. */
  ativo: boolean;
  aoChegar: (novas: Mensagem[]) => void;
  aoPerderAcesso: () => void;
}

const dormir = (ms: number, sinal: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    sinal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true });
  });

const ehStatus = (e: unknown, ...status: number[]) => e instanceof ErroApi && status.includes(e.status);

/** Histórico + long-poll de uma sala. Troca de sala aborta tudo da anterior. */
export function useConversa({ sala, ativo, aoChegar, aoPerderAcesso }: Opcoes) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [estado, setEstado] = useState<EstadoConexao>({ tipo: "carregando" });
  const [temMais, setTemMais] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const historicoSuportado = useRef(true);
  const ultimoId = useRef(0);
  const controle = useRef<AbortController | null>(null);
  const callbacks = useRef({ aoChegar, aoPerderAcesso });
  useLayoutEffect(() => { callbacks.current = { aoChegar, aoPerderAcesso }; });

  const anexar = useCallback((novas: Mensagem[]) => {
    const filtradas = novas.filter((m) => m.id > ultimoId.current);
    if (!filtradas.length) return;
    ultimoId.current = filtradas.at(-1)?.id ?? ultimoId.current;
    setMensagens((atual) => [...atual, ...filtradas]);
    callbacks.current.aoChegar(filtradas);
  }, []);

  const escutar = useCallback(async (sinal: AbortSignal) => {
    let falhas = 0;
    while (!sinal.aborted) {
      try {
        const q = new URLSearchParams({ sala, depois: String(ultimoId.current), todas: "1", espera: "25" });
        const r = await api<RespostaMensagens>(`/mensagens?${q}`, { sinal });
        falhas = 0;
        setEstado({ tipo: "ao-vivo" });
        anexar(listaDe(r));
      } catch (e) {
        if (sinal.aborted || ehAbort(e)) return;
        if (ehStatus(e, 401)) {
          setEstado({ tipo: "sem-acesso" });
          callbacks.current.aoPerderAcesso();
          return;
        }
        falhas++;
        // Retry-After do servidor; senão backoff exponencial com jitter (1 s → 30 s).
        const retry = e instanceof ErroApi ? e.retryAfter : null;
        const espera = retry ? retry * 1000 : Math.min(30_000, 1000 * 2 ** (falhas - 1)) * (0.5 + Math.random());
        setEstado({ tipo: "reconectando", emSegundos: Math.round(espera / 1000) });
        await dormir(espera, sinal);
      }
    }
  }, [sala, anexar]);

  const reconectar = useCallback(() => {
    controle.current?.abort();
    const c = new AbortController();
    controle.current = c;
    void escutar(c.signal);
  }, [escutar]);

  useEffect(() => {
    if (!ativo) return;
    const c = new AbortController();
    controle.current = c;
    ultimoId.current = 0;
    setMensagens([]);
    setTemMais(false);
    setEstado({ tipo: "carregando" });

    (async () => {
      try {
        let iniciais: Mensagem[];
        if (historicoSuportado.current) {
          try {
            const p = await api<PaginaHistorico>(`/mensagens/historico?${new URLSearchParams({ sala, limite: "50" })}`, { sinal: c.signal });
            iniciais = p.mensagens;
            setTemMais(p.tem_mais);
          } catch (e) {
            if (!ehStatus(e, 404)) throw e;
            historicoSuportado.current = false;
            iniciais = listaDe(await api<RespostaMensagens>(`/mensagens?${new URLSearchParams({ sala, todas: "1" })}`, { sinal: c.signal }));
          }
        } else {
          iniciais = listaDe(await api<RespostaMensagens>(`/mensagens?${new URLSearchParams({ sala, todas: "1" })}`, { sinal: c.signal }));
        }
        if (c.signal.aborted) return;
        ultimoId.current = iniciais.at(-1)?.id ?? 0;
        setMensagens(iniciais);
        setEstado({ tipo: "ao-vivo" });
        void escutar(c.signal);
      } catch (e) {
        if (c.signal.aborted || ehAbort(e)) return;
        if (ehStatus(e, 401)) callbacks.current.aoPerderAcesso();
        else void escutar(c.signal);
      }
    })();

    // Celular congela a aba em segundo plano e mata o long-poll: ao voltar, reconecta.
    const aoVoltar = () => { if (!document.hidden) reconectar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", reconectar);
    return () => {
      controle.current?.abort();
      c.abort();
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", reconectar);
    };
  }, [sala, ativo, escutar, reconectar]);

  const carregarAntigas = useCallback(async () => {
    const menor = mensagens[0]?.id;
    if (!temMais || carregandoAntigas || menor === undefined || !historicoSuportado.current) return;
    setCarregandoAntigas(true);
    try {
      const q = new URLSearchParams({ sala, antes: String(menor), limite: "50" });
      const p = await api<PaginaHistorico>(`/mensagens/historico?${q}`, { sinal: controle.current?.signal });
      setTemMais(p.tem_mais);
      setMensagens((atual) => [...p.mensagens.filter((m) => m.id < menor), ...atual]);
    } catch {
      /* tenta de novo no próximo scroll */
    } finally {
      setCarregandoAntigas(false);
    }
  }, [mensagens, temMais, carregandoAntigas, sala]);

  return { mensagens, estado, temMais, carregandoAntigas, carregarAntigas };
}
