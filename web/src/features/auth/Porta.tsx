import { useState, type FormEvent } from "react";
import { ErroApi } from "../../shared/api/cliente";
import { ler } from "../../shared/lib/armazenamento";
import { normalizarNome } from "../../shared/lib/formato";
import { useSessao } from "./sessao";

export function Porta() {
  const { entrar, motivoSaida } = useSessao();
  const [nome, setNome] = useState(() => ler("relay-nome") ?? "");
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(motivoSaida);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    const normalizado = normalizarNome(nome);
    if (!normalizado) return setErro("Nome inválido.");
    setEnviando(true);
    setErro(null);
    try {
      await entrar(normalizado, token.trim());
    } catch (err) {
      setErro(err instanceof ErroApi && err.status === 401 ? "Token inválido." : "Servidor não respondeu.");
    } finally {
      setEnviando(false);
    }
  }

  const campo = "rounded-[10px] border border-borda bg-fundo px-3.5 py-2.5 font-mono text-base outline-none focus:border-acento sm:text-sm";
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-fundo p-4">
      <form onSubmit={aoEnviar} className="grid w-full max-w-sm gap-3.5 rounded-2xl border border-borda bg-painel p-7">
        <h1 className="text-lg font-semibold">Relay</h1>
        <p className="text-[13px] text-suave">
          Seu nome aparece nas mensagens que você mandar. O token (RELAY_TOKEN) só sai daqui para o servidor do relay.
        </p>
        <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="seu nome (ex.: jose)"
          aria-label="Seu nome" autoComplete="nickname" maxLength={32} required autoFocus={!nome} />
        <input className={campo} value={token} onChange={(e) => setToken(e.target.value)} placeholder="token"
          aria-label="Token" type="password" autoComplete="off" required autoFocus={Boolean(nome)} />
        <p role="alert" className="min-h-[1em] text-[13px] text-erro">{erro}</p>
        <button disabled={enviando} className="min-h-11 rounded-[10px] bg-acento px-4 font-medium text-white disabled:opacity-50">
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
