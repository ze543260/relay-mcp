import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api, configurarAuth, ErroApi, type ModoAuth } from "../../shared/api/cliente";
import { gravar, ler } from "../../shared/lib/armazenamento";

interface Sessao {
  nome: string;
  logado: boolean;
  entrar: (nome: string, token: string) => Promise<void>;
  sair: (motivo?: string) => void;
  motivoSaida: string | null;
}

const ContextoSessao = createContext<Sessao | null>(null);

// Roda uma vez, antes do primeiro render: o cliente da API nasce com a credencial salva.
function estadoInicial(): { modo: ModoAuth; token: string; nome: string } {
  const modo: ModoAuth = ler("relay-modo") === "cookie" ? "cookie" : "bearer";
  const token = modo === "bearer" ? (ler("relay-token") ?? "") : "";
  configurarAuth(modo, token);
  return { modo, token, nome: ler("relay-nome") ?? "" };
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [estado] = useState(estadoInicial);
  const [nome, setNome] = useState(estado.nome);
  const [logado, setLogado] = useState(Boolean(estado.nome && (estado.modo === "cookie" || estado.token)));
  const [motivoSaida, setMotivo] = useState<string | null>(null);

  const entrar = useCallback(async (novoNome: string, token: string) => {
    let modo: ModoAuth = "cookie";
    try {
      configurarAuth("cookie", "");
      await api<void>("/sessao", { metodo: "POST", corpo: { token } });
    } catch (e) {
      // Servidor sem /sessao (404/405, ou 401 por checar o token antes da rota): Bearer.
      if (!(e instanceof ErroApi) || ![401, 404, 405].includes(e.status)) throw e;
      modo = "bearer";
      configurarAuth("bearer", token);
      await api<unknown>("/salas");
    }
    gravar("relay-modo", modo);
    gravar("relay-token", modo === "bearer" ? token : null);
    gravar("relay-nome", novoNome);
    setNome(novoNome);
    setMotivo(null);
    setLogado(true);
  }, []);

  const sair = useCallback((motivo?: string) => {
    void api<void>("/sessao", { metodo: "DELETE" }).catch(() => undefined);
    configurarAuth("bearer", "");
    gravar("relay-token", null);
    setMotivo(motivo ?? null);
    setLogado(false);
  }, []);

  const valor = useMemo(() => ({ nome, logado, entrar, sair, motivoSaida }), [nome, logado, entrar, sair, motivoSaida]);
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(ContextoSessao);
  if (!s) throw new Error("useSessao fora do ProvedorSessao");
  return s;
}
