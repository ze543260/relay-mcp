import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { Mensagem } from "./Mensagem";

interface Props {
  sala: string;
  eu: string;
  mensagens: TMensagem[];
  carregando: boolean;
  temMais: boolean;
  carregandoAntigas: boolean;
  carregarAntigas: () => void;
}

const PERTO_DO_FIM = 80;
const PERTO_DO_TOPO = 400;

/** Lista virtualizada: só as mensagens visíveis (+ margem) ficam no DOM. */
export function Conversa({ sala, eu, mensagens, carregando, temMais, carregandoAntigas, carregarAntigas }: Props) {
  const feed = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const presoNoFim = useRef(true);
  const primeiroId = useRef<number | undefined>(undefined);
  const alturaAntes = useRef(0);

  const virtual = useVirtualizer({
    count: mensagens.length,
    getScrollElement: () => feed.current,
    estimateSize: () => 84,
    overscan: 8,
    gap: 12,
    getItemKey: (i) => mensagens[i]?.id ?? i,
  });

  // Prepend (histórico) preserva a posição; o resto gruda no fim se já estava lá.
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el) return;
    const novoPrimeiro = mensagens[0]?.id;
    const prefixou = primeiroId.current !== undefined && novoPrimeiro !== undefined && novoPrimeiro < primeiroId.current;
    if (prefixou) el.scrollTop += virtual.getTotalSize() - alturaAntes.current;
    else if (presoNoFim.current) el.scrollTop = el.scrollHeight;
    primeiroId.current = novoPrimeiro;
    alturaAntes.current = virtual.getTotalSize();
  }, [mensagens, virtual]);

  // Medições reais (Markdown, KaTeX, imagens) e o teclado do celular mudam alturas: mantém o fim.
  useEffect(() => {
    const el = feed.current;
    const conteudo = lista.current;
    if (!el || !conteudo) return;
    const obs = new ResizeObserver(() => {
      if (presoNoFim.current) el.scrollTop = el.scrollHeight;
      alturaAntes.current = virtual.getTotalSize();
    });
    obs.observe(el);
    obs.observe(conteudo);
    return () => obs.disconnect();
  }, [virtual]);

  function aoRolar() {
    const el = feed.current;
    if (!el) return;
    presoNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM;
    if (el.scrollTop < PERTO_DO_TOPO && temMais && !carregandoAntigas) carregarAntigas();
  }

  // Leitor de tela anuncia só a última mensagem de outra pessoa.
  const ultima = mensagens.at(-1);
  const anuncio = ultima && ultima.de !== eu ? `${ultima.de}: ${ultima.texto.slice(0, 200)}` : "";
  const itens = virtual.getVirtualItems();

  return (
    <>
      <div ref={feed} onScroll={aoRolar} role="log" aria-live="off" aria-label="Mensagens" tabIndex={0}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:p-6">
        <div className="mb-3 min-h-px text-center text-xs text-muted-foreground">
          {carregandoAntigas ? "carregando…" : !temMais && mensagens.length > 0 ? "início da conversa" : ""}
        </div>
        {carregando && mensagens.length === 0 ? (
          <div className="grid gap-4" aria-label="Carregando mensagens">
            {[60, 85, 40].map((w) => (
              <div key={w} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-12" style={{ width: `${w}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : mensagens.length === 0 ? (
          <div className="mx-auto mt-[20vh] max-w-80 text-center text-muted-foreground">
            <h2 className="mb-1.5 text-[15px] font-semibold text-foreground">Nada por aqui ainda</h2>
            As mensagens aparecem em tempo real quando alguém escrever em #{sala}.
          </div>
        ) : (
          <div ref={lista} className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {itens.map((item) => {
              const m = mensagens[item.index];
              if (!m) return null;
              return (
                <div key={item.key} data-index={item.index} ref={virtual.measureElement}
                  className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${item.start}px)` }}>
                  <Mensagem m={m} minha={m.de === eu} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{anuncio}</div>
    </>
  );
}
