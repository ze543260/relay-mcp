import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { avisar } from "@/shared/lib/avisar";
import { api, ehAbort, ErroApi, listaDe } from "@/shared/api/cliente";
import { traduzirErro } from "@/shared/api/erros";
import type { Anexo, Mensagem, PaginaHistorico, RespostaMensagens } from "@/shared/api/tipos";
import { novoId } from "@/shared/lib/formato";

/** Mensagem enviada por mim que ainda não voltou do servidor. */
export interface Pendente {
  client_id: string;
  de: string;
  texto: string;
  reply_to?: number;
  anexos?: Anexo[];
  criado_em: string;
  estado: "enviando" | "erro";
  idReal?: number;
}

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
  aoEvento?: (tipo: "tarefa" | "reuniao" | "leitura" | "apelido") => void;
}

const dormir = (ms: number, sinal: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    sinal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true });
  });

const ehStatus = (e: unknown, ...status: number[]) => e instanceof ErroApi && status.includes(e.status);
const FALHAS_SSE_ATE_LONGPOLL = 3;

/** Histórico + tempo real (SSE, com long-poll de reserva) de uma sala. */
export function useConversa({ sala, ativo, aoChegar, aoPerderAcesso, aoEvento }: Opcoes) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [estado, setEstado] = useState<EstadoConexao>({ tipo: "carregando" });
  const [temMais, setTemMais] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [digitando, setDigitando] = useState<string[]>([]);
  const ultimoId = useRef(0);
  const controle = useRef<AbortController | null>(null);
  const callbacks = useRef({ aoChegar, aoPerderAcesso, aoEvento });
  useLayoutEffect(() => { callbacks.current = { aoChegar, aoPerderAcesso, aoEvento }; });

  const anexar = useCallback((novas: Mensagem[]) => {
    const filtradas = novas.filter((m) => m.id > ultimoId.current);
    if (!filtradas.length) return;
    ultimoId.current = filtradas.at(-1)?.id ?? ultimoId.current;
    setMensagens((atual) => [...atual, ...filtradas]);
    // A versão real substitui a otimista: por id do POST, por client_id ou por autor + texto.
    setPendentes((ps) => ps.filter((p) => !filtradas.some((m) =>
      (p.idReal !== undefined && m.id === p.idReal) ||
      (m.client_id !== undefined && m.client_id === p.client_id) ||
      (p.estado === "enviando" && p.idReal === undefined && m.de === p.de && m.texto === p.texto))));
    callbacks.current.aoChegar(filtradas);
  }, []);

  const remover = useCallback((id: number) => {
    setMensagens((atual) => atual.filter((m) => m.id !== id));
  }, []);

  const longPoll = useCallback(async (sinal: AbortSignal) => {
    let falhas = 0;
    while (!sinal.aborted) {
      try {
        const q = new URLSearchParams({ sala, depois: String(ultimoId.current), todas: "1", espera: "25" });
        anexar(listaDe(await api<RespostaMensagens>(`/mensagens?${q}`, { sinal })));
        falhas = 0;
        setEstado({ tipo: "ao-vivo" });
      } catch (e) {
        if (sinal.aborted || ehAbort(e)) return;
        if (ehStatus(e, 401)) {
          setEstado({ tipo: "sem-acesso" });
          return callbacks.current.aoPerderAcesso();
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

  /** SSE com reconexão nativa (Last-Event-ID); depois de falhas seguidas, long-poll. */
  const escutar = useCallback((sinal: AbortSignal) => {
    if (typeof EventSource === "undefined") return void longPoll(sinal);
    let falhas = 0;
    const q = new URLSearchParams({ sala, todas: "1", depois: String(ultimoId.current) });
    const es = new EventSource(`/mensagens/stream?${q}`);
    es.onopen = () => { falhas = 0; setEstado({ tipo: "ao-vivo" }); };
    es.addEventListener("mensagem", (e) => anexar([JSON.parse((e as MessageEvent<string>).data) as Mensagem]));
    es.addEventListener("apagada", (e) => remover((JSON.parse((e as MessageEvent<string>).data) as { id: number }).id));
    es.addEventListener("tarefa", () => callbacks.current.aoEvento?.("tarefa"));
    es.addEventListener("reuniao", () => callbacks.current.aoEvento?.("reuniao"));
    es.addEventListener("leitura", () => callbacks.current.aoEvento?.("leitura"));
    es.addEventListener("apelido", () => callbacks.current.aoEvento?.("apelido"));
    es.addEventListener("digitando", (e) => setDigitando((JSON.parse((e as MessageEvent<string>).data) as { nomes: string[] }).nomes));
    es.onerror = () => {
      if (sinal.aborted) return;
      falhas++;
      if (falhas >= FALHAS_SSE_ATE_LONGPOLL || es.readyState === EventSource.CLOSED) {
        es.close();
        // Pode ser sessão expirada (EventSource não mostra o status): o long-poll descobre.
        void longPoll(sinal);
      } else {
        setEstado({ tipo: "reconectando", emSegundos: 3 });
      }
    };
    sinal.addEventListener("abort", () => es.close(), { once: true });
  }, [sala, anexar, remover, longPoll]);

  const reconectar = useCallback(() => {
    controle.current?.abort();
    const c = new AbortController();
    controle.current = c;
    escutar(c.signal);
  }, [escutar]);

  useEffect(() => {
    if (!ativo) return;
    const c = new AbortController();
    controle.current = c;
    ultimoId.current = 0;
    setMensagens([]);
    setPendentes([]);
    setDigitando([]);
    setTemMais(false);
    setEstado({ tipo: "carregando" });

    (async () => {
      try {
        const p = await api<PaginaHistorico>(`/mensagens/historico?${new URLSearchParams({ sala, limite: "50", todas: "1" })}`, { sinal: c.signal });
        if (c.signal.aborted) return;
        ultimoId.current = p.mensagens.at(-1)?.id ?? 0;
        setMensagens(p.mensagens);
        setTemMais(p.tem_mais);
        setEstado({ tipo: "ao-vivo" });
        escutar(c.signal);
      } catch (e) {
        if (c.signal.aborted || ehAbort(e)) return;
        if (ehStatus(e, 401)) callbacks.current.aoPerderAcesso();
        else escutar(c.signal);
      }
    })();

    // Celular congela a aba em segundo plano: ao voltar, reabre o stream na hora.
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
    if (!temMais || carregandoAntigas || menor === undefined) return;
    setCarregandoAntigas(true);
    try {
      const q = new URLSearchParams({ sala, antes: String(menor), limite: "50", todas: "1" });
      const p = await api<PaginaHistorico>(`/mensagens/historico?${q}`, { sinal: controle.current?.signal });
      setTemMais(p.tem_mais);
      setMensagens((atual) => [...p.mensagens.filter((m) => m.id < menor), ...atual]);
    } catch {
      /* tenta de novo no próximo scroll */
    } finally {
      setCarregandoAntigas(false);
    }
  }, [mensagens, temMais, carregandoAntigas, sala]);

  const postar = useCallback(async (p: Pendente) => {
    setPendentes((ps) => ps.map((x) => (x.client_id === p.client_id ? { ...x, estado: "enviando" } : x)));
    try {
      const r = await api<{ id: number }>("/mensagens", {
        metodo: "POST",
        corpo: {
          sala, texto: p.texto, client_id: p.client_id,
          ...(p.reply_to ? { reply_to: p.reply_to } : {}),
          ...(p.anexos?.length ? { anexos: p.anexos.map((a) => a.id) } : {}),
        },
      });
      setPendentes((ps) => r.id <= ultimoId.current
        ? ps.filter((x) => x.client_id !== p.client_id)
        : ps.map((x) => (x.client_id === p.client_id ? { ...x, idReal: r.id } : x)));
    } catch (e) {
      if (ehStatus(e, 401)) return callbacks.current.aoPerderAcesso();
      setPendentes((ps) => ps.map((x) => (x.client_id === p.client_id ? { ...x, estado: "erro" } : x)));
      avisar("erro", traduzirErro(e).mensagem);
    }
  }, [sala]);

  const enviar = useCallback((texto: string, de: string, replyTo?: number, anexos?: Anexo[]) => {
    const p: Pendente = { client_id: novoId(), de, texto, reply_to: replyTo, anexos, criado_em: new Date().toISOString(), estado: "enviando" };
    setPendentes((ps) => [...ps, p]);
    void postar(p);
  }, [postar]);

  const retentar = useCallback((clientId: string) => {
    const p = pendentes.find((x) => x.client_id === clientId);
    if (p) void postar(p);
  }, [pendentes, postar]);

  const descartar = useCallback((clientId: string) => {
    setPendentes((ps) => ps.filter((x) => x.client_id !== clientId));
  }, []);

  const apagar = useCallback(async (id: number) => {
    try {
      await api<void>(`/mensagens/${id}`, { metodo: "DELETE" });
      remover(id);
    } catch (e) {
      avisar("erro", traduzirErro(e).mensagem);
    }
  }, [remover]);

  return { mensagens, pendentes, digitando, estado, temMais, carregandoAntigas, carregarAntigas, enviar, retentar, descartar, apagar };
}
