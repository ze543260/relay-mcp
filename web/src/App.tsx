import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Porta } from "./features/auth/Porta";
import { useSessao } from "./features/auth/sessao";
import { Composer } from "./features/mensagens/Composer";
import { Conversa } from "./features/mensagens/Conversa";
import { useConversa, type EstadoConexao } from "./features/mensagens/useConversa";
import { Participantes } from "./features/presenca/Participantes";
import { ListaSalas } from "./features/salas/ListaSalas";
import type { Mensagem } from "./shared/api/tipos";
import { gravar, ler, lerJson } from "./shared/lib/armazenamento";

function textoEstado(e: EstadoConexao, aviso: string | null): string {
  if (aviso) return aviso;
  switch (e.tipo) {
    case "carregando": return "carregando…";
    case "ao-vivo": return "ao vivo";
    case "reconectando": return `reconectando em ${e.emSegundos} s`;
    case "sem-acesso": return "sem acesso";
  }
}

function Sala({ sala, setSala }: { sala: string; setSala: (s: string) => void }) {
  const { nome, sair } = useSessao();
  const qc = useQueryClient();
  const [lateralAberta, setLateralAberta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vistas, setVistas] = useState<Record<string, number>>(() => lerJson("relay-vistas", {}));
  const toqueX = useRef<number | null>(null);

  const aoChegar = useCallback((novas: Mensagem[]) => {
    const ultimo = novas.at(-1)?.id ?? 0;
    setVistas((v) => {
      const prox = { ...v, [sala]: Math.max(v[sala] ?? 0, ultimo) };
      gravar("relay-vistas", JSON.stringify(prox));
      return prox;
    });
    void qc.invalidateQueries({ queryKey: ["salas"] });
  }, [sala, qc]);

  const perderAcesso = useCallback(() => sair("Sessão expirada. Entre de novo."), [sair]);
  const conversa = useConversa({ sala, aoChegar, aoPerderAcesso: perderAcesso });
  const autores = [...new Set(conversa.mensagens.map((m) => m.de))];

  useEffect(() => { document.title = `#${sala} · Relay`; }, [sala]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setLateralAberta(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  const vivo = conversa.estado.tipo === "ao-vivo" && !aviso;
  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[260px_1fr]">
      <div onClick={() => setLateralAberta(false)} aria-hidden
        className={`fixed inset-0 z-5 bg-black/40 transition-opacity md:hidden ${lateralAberta ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside id="lateral" aria-label="Salas"
        onTouchStart={(e) => { toqueX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const fim = e.changedTouches[0]?.clientX;
          if (toqueX.current !== null && fim !== undefined && toqueX.current - fim > 60) setLateralAberta(false);
          toqueX.current = null;
        }}
        className={`fixed inset-y-0 left-0 z-6 flex w-[84%] max-w-80 flex-col border-r border-borda bg-painel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0 md:p-0 ${lateralAberta ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 border-b border-borda p-4 md:px-5">
          <span aria-hidden className={`size-2 rounded-full ${vivo ? "bg-ok motion-safe:animate-[pulso_2s_infinite]" : "bg-suave"}`} />
          <b className="font-semibold tracking-tight">Relay</b>
          <span className="ml-auto text-xs text-suave" aria-live="polite">{textoEstado(conversa.estado, aviso)}</span>
          <button onClick={() => sair()} title="Sair" aria-label="Sair"
            className="grid size-11 place-items-center rounded-md text-suave hover:bg-fundo hover:text-texto md:size-7">⎋</button>
        </div>
        <div className="px-5 pt-4 pb-1.5 text-[11px] tracking-widest text-suave uppercase">Salas</div>
        <ListaSalas atual={sala} vistas={vistas} aoEscolher={(s) => { setSala(s); setLateralAberta(false); }} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-borda px-4 pt-[calc(.5rem+env(safe-area-inset-top))] pb-2 md:flex-nowrap md:gap-3 md:px-6 md:py-3.5">
          <button onClick={() => setLateralAberta((a) => !a)} aria-label="Abrir salas" aria-expanded={lateralAberta} aria-controls="lateral"
            className="-ml-2 grid size-11 place-items-center text-lg md:hidden">☰</button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:flex-none">#{sala}</h1>
          <Participantes autores={autores} />
        </header>
        <Conversa sala={sala} eu={nome} {...conversa} />
        <Composer sala={sala} nome={nome} aoFalhar={setAviso} aoPerderAcesso={perderAcesso} />
      </main>
    </div>
  );
}

export default function App() {
  const { logado } = useSessao();
  const [sala, setSalaEstado] = useState(() => ler("relay-sala") ?? "geral");
  const setSala = useCallback((s: string) => { setSalaEstado(s); gravar("relay-sala", s); }, []);
  return logado ? <Sala sala={sala} setSala={setSala} /> : <Porta />;
}
