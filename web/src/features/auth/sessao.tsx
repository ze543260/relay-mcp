import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, configurarAuth, ErroApi } from "@/shared/api/cliente";
import { gravar, ler } from "@/shared/lib/armazenamento";

interface Sessao {
  nome: string;
  admin: boolean;
  /** "verificando" só na abertura do app, enquanto o cookie é conferido com /eu. */
  estado: "verificando" | "dentro" | "fora";
  logado: boolean;
  entrar: (nome: string, token: string) => Promise<void>;
  sair: (motivo?: string) => void;
  motivoSaida: string | null;
}

interface RespostaEu {
  nome: string | null;
  admin: boolean;
}

const ContextoSessao = createContext<Sessao | null>(null);

// O token nunca fica no navegador: vira cookie HttpOnly no servidor (POST /sessao).
configurarAuth("cookie", "");
// Limpa o que versões antigas guardavam.
gravar("relay-token", null);
gravar("relay-modo", null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [nome, setNome] = useState(() => ler("relay-nome") ?? "");
  const [admin, setAdmin] = useState(false);
  const [estado, setEstado] = useState<Sessao["estado"]>("verificando");
  const [motivoSaida, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    api<RespostaEu>("/eu", { sinal: c.signal })
      .then((eu) => {
        if (eu.nome) setNome(eu.nome);
        setAdmin(eu.admin);
        setEstado(eu.nome ? "dentro" : "fora");
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted) setEstado(e instanceof ErroApi && e.status === 401 ? "fora" : "dentro");
      });
    return () => c.abort();
  }, []);

  const entrar = useCallback(async (novoNome: string, token: string) => {
    // Token de admin usa o nome digitado; token de agente traz o nome do próprio servidor.
    const eu = await api<RespostaEu>("/sessao", { metodo: "POST", corpo: { token, nome: novoNome } });
    const final = eu.nome ?? novoNome;
    gravar("relay-nome", final);
    setNome(final);
    setAdmin(eu.admin);
    setMotivo(null);
    setEstado("dentro");
  }, []);

  const sair = useCallback((motivo?: string) => {
    void api<void>("/sessao", { metodo: "DELETE" }).catch(() => undefined);
    setMotivo(motivo ?? null);
    setAdmin(false);
    setEstado("fora");
  }, []);

  const valor = useMemo<Sessao>(
    () => ({ nome, admin, estado, logado: estado === "dentro", entrar, sair, motivoSaida }),
    [nome, admin, estado, entrar, sair, motivoSaida],
  );
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(ContextoSessao);
  if (!s) throw new Error("useSessao fora do ProvedorSessao");
  return s;
}
