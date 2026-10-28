import { useEffect, useLayoutEffect, useRef } from "react";
import type { Mensagem as TMensagem } from "../../shared/api/tipos";
import { Mensagem } from "./Mensagem";

interface Props {
  sala: string;
  eu: string;
  mensagens: TMensagem[];
  temMais: boolean;
  carregandoAntigas: boolean;
  carregarAntigas: () => void;
}

const PERTO_DO_FIM = 80;

export function Conversa({ sala, eu, mensagens, temMais, carregandoAntigas, carregarAntigas }: Props) {
  const feed = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  const presoNoFim = useRef(true);
  const alturaAntes = useRef(0);
  const primeiroId = useRef<number | undefined>(undefined);

  // Ao trocar de sala, volta a grudar no fim.
  useEffect(() => { presoNoFim.current = true; }, [sala]);

  // Prepend (histórico) preserva a posição; append só rola se já estava no fim.
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el) return;
    const novoPrimeiro = mensagens[0]?.id;
    const prefixou = primeiroId.current !== undefined && novoPrimeiro !== undefined && novoPrimeiro < primeiroId.current;
    if (prefixou) el.scrollTop += el.scrollHeight - alturaAntes.current;
    else if (presoNoFim.current) el.scrollTop = el.scrollHeight;
    primeiroId.current = novoPrimeiro;
    alturaAntes.current = el.scrollHeight;
  }, [mensagens]);

  // Leitor de tela anuncia só a última mensagem de outra pessoa.
  const ultima = mensagens.at(-1);
  const anuncio = ultima && ultima.de !== eu ? `${ultima.de}: ${ultima.texto.slice(0, 200)}` : "";

  useEffect(() => {
    const el = topo.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e?.isIntersecting) carregarAntigas(); }, { root: feed.current });
    obs.observe(el);
    return () => obs.disconnect();
  }, [carregarAntigas]);

  // Teclado do celular encolhe o feed: se estava no fim, continua no fim.
  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    const obs = new ResizeObserver(() => { if (presoNoFim.current) el.scrollTop = el.scrollHeight; });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div ref={feed} role="log" aria-live="off" aria-label="Mensagens" tabIndex={0}
        onScroll={(e) => { const el = e.currentTarget; presoNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM; alturaAntes.current = el.scrollHeight; }}
        className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4 focus-visible:outline-2 focus-visible:outline-acento md:gap-3.5 md:p-6">
        <div ref={topo} className="min-h-px text-center text-xs text-suave">
          {carregandoAntigas ? "carregando…" : !temMais && mensagens.length > 0 ? "início da conversa" : ""}
        </div>
        {mensagens.length === 0 ? (
          <div className="m-auto max-w-80 text-center text-suave">
            <h2 className="mb-1.5 text-[15px] font-semibold text-texto">Nada por aqui ainda</h2>
            As mensagens aparecem em tempo real quando alguém escrever em #{sala}.
          </div>
        ) : (
          mensagens.map((m) => <Mensagem key={m.id} m={m} minha={m.de === eu} />)
        )}
      </div>
      <div className="sr-only" aria-live="polite">{anuncio}</div>
    </>
  );
}
