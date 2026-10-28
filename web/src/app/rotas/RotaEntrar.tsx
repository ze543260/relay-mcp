import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSessao } from "@/features/auth/sessao";
import { ErroApi } from "@/shared/api/cliente";
import { ler } from "@/shared/lib/armazenamento";
import { normalizarNome } from "@/shared/lib/formato";
import { rotaEntrar } from "../router";

export function RotaEntrar() {
  const { entrar, logado, motivoSaida } = useSessao();
  const { volta } = rotaEntrar.useSearch();
  const navegar = useNavigate();
  const [nome, setNome] = useState(() => ler("relay-nome") ?? "");
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(motivoSaida);
  const [enviando, setEnviando] = useState(false);
  const destino = volta ?? ler("relay-sala") ?? "geral";

  if (logado && !enviando) return <Navigate to="/s/$sala" params={{ sala: destino }} replace />;

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    const normalizado = normalizarNome(nome);
    if (!normalizado) return setErro("Nome inválido.");
    setEnviando(true);
    setErro(null);
    try {
      await entrar(normalizado, token.trim());
      void navegar({ to: "/s/$sala", params: { sala: destino }, replace: true });
    } catch (err) {
      setErro(err instanceof ErroApi && err.status === 401 ? "Token inválido." : "Servidor não respondeu.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="grid h-dvh place-items-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Relay</CardTitle>
          <CardDescription>
            Seu nome aparece nas mensagens que você mandar. O token (RELAY_TOKEN) só sai daqui para o servidor do relay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={aoEnviar} className="grid gap-3">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="seu nome (ex.: jose)" aria-label="Seu nome"
              autoComplete="nickname" maxLength={32} required autoFocus={!nome} className="h-11 font-mono text-base md:h-10 md:text-sm" />
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" aria-label="Token" type="password"
              autoComplete="off" required autoFocus={Boolean(nome)} className="h-11 font-mono text-base md:h-10 md:text-sm" />
            <p role="alert" className="min-h-[1lh] text-[13px] text-destructive">{erro}</p>
            <Button type="submit" size="lg" disabled={enviando} className="h-11">
              {enviando ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
