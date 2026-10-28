import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { textos } from "@/shared/lib/textos";
import { Mensagem } from "./Mensagem";
import type { Pendente } from "./useConversa";

interface Props {
  sala: string;
  eu: string;
  mensagens: TMensagem[];
  pendentes: Pendente[];
  carregando: boolean;
  temMais: boolean;
  carregandoAntigas: boolean;
  /** Último id que a pessoa já tinha visto ao abrir a sala (0 = nunca abriu). */
  ultimaLida: number;
  carregarAntigas: () => void;
  aoLer: (id: number) => void;
  retentar: (clientId: string) => void;
  descartar: (clientId: string) => void;
  admin: boolean;
  aoResponder: (m: TMensagem) => void;
  apagar: (id: number) => void;
  digitando: string[];
  /** nome -> último id lido (sem mim). */
  leituras: Map<string, number>;
}

type Item =
  | { tipo: "msg"; m: TMensagem }
  | { tipo: "pendente"; p: Pendente }
  | { tipo: "divisor" };

const PERTO_DO_FIM = 80;
const t = textos.conversa;

function Digitando({ nomes }: { nomes: string[] }) {
  const texto = nomes.length === 0 ? "" : nomes.length === 1 ? t.digitando1(nomes[0]!)
    : nomes.length === 2 ? t.digitando2(nomes[0]!, nomes[1]!) : t.digitandoVarios(nomes.length);
  return (
    <div aria-live="polite" className={cn("flex h-6 items-center gap-2 px-4 text-xs text-muted-foreground transition-opacity md:px-6", !texto && "opacity-0")}>
      {texto && (
        <>
          <span className="flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => <i key={i} className="size-1 rounded-full bg-muted-foreground motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
          </span>
          {texto}
        </>
      )}
    </div>
  );
}

/** Lista virtualizada com marcador de não lidas: só o que está visível (+ margem) fica no DOM. */
export function Conversa(props: Props) {
  const { sala, eu, mensagens, pendentes, carregando, temMais, carregandoAntigas, ultimaLida, carregarAntigas, aoLer, retentar, descartar, admin, aoResponder, apagar, digitando, leituras } = props;
  // Avatares de "visto": cada leitor aparece na última mensagem que leu (estilo Messenger).
  const vistoEm = new Map<number, string[]>();
  for (const [nome, ate] of leituras) {
    let alvo: number | undefined;
    for (let i = mensagens.length - 1; i >= 0; i--) if (mensagens[i]!.id <= ate) { alvo = mensagens[i]!.id; break; }
    if (alvo !== undefined) vistoEm.set(alvo, [...(vistoEm.get(alvo) ?? []), nome]);
  }
  const leitores = [...leituras.keys()];
  const vistaPorTodos = (id: number) => leitores.length > 0 && leitores.every((n) => (leituras.get(n) ?? 0) >= id);
  const porId = new Map(mensagens.map((m) => [m.id, m]));
  const mencao = new RegExp(`@${eu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const feed = useRef<HTMLDivElement>(null);
  const presoNoFim = useRef(true);
  const posicionado = useRef(false);
  const primeiroId = useRef<number | undefined>(undefined);
  const alturaAntes = useRef(0);
  const [noFim, setNoFim] = useState(true);
  // Marco de leitura: o divisor fica antes da primeira mensagem (de outra pessoa) depois dele.
  const [marco, setMarco] = useState(ultimaLida);

  const ultimoId = mensagens.at(-1)?.id ?? 0;
  const indiceNova = marco > 0 ? mensagens.findIndex((m) => m.id > marco && m.de !== eu) : -1;
  const itens: Item[] = [];
  mensagens.forEach((m, i) => {
    if (i === indiceNova) itens.push({ tipo: "divisor" });
    itens.push({ tipo: "msg", m });
  });
  for (const p of pendentes) itens.push({ tipo: "pendente", p });
  const novasAbaixo = noFim ? 0 : mensagens.filter((m) => m.id > marco && m.de !== eu).length;

  const virtual = useVirtualizer({
    count: itens.length,
    getScrollElement: () => feed.current,
    estimateSize: (i) => (itens[i]?.tipo === "divisor" ? 28 : 84),
    overscan: 8,
    gap: 12,
    getItemKey: (i) => {
      const it = itens[i];
      if (!it) return i;
      return it.tipo === "msg" ? it.m.id : it.tipo === "pendente" ? `p-${it.p.client_id}` : "divisor";
    },
  });

  const irParaFim = useCallback(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Marca como lida só o que a pessoa vê: no fim da lista e com a aba visível.
  const lerSeVisivel = useCallback(() => {
    if (presoNoFim.current && !document.hidden && ultimoId > 0) aoLer(ultimoId);
  }, [aoLer, ultimoId]);

  // Primeira carga: abre no divisor de não lidas; sem não lidas, no fim.
  useLayoutEffect(() => {
    if (posicionado.current || mensagens.length === 0) return;
    posicionado.current = true;
    const idx = itens.findIndex((it) => it.tipo === "divisor");
    if (idx >= 0) {
      presoNoFim.current = false;
      setNoFim(false);
      virtual.scrollToIndex(idx, { align: "start" });
    } else {
      irParaFim();
    }
  });

  // Prepend (histórico) preserva a posição; o resto gruda no fim se já estava lá.
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el || !posicionado.current) return;
    const novoPrimeiro = mensagens[0]?.id;
    const prefixou = primeiroId.current !== undefined && novoPrimeiro !== undefined && novoPrimeiro < primeiroId.current;
    if (prefixou) el.scrollTop += virtual.getTotalSize() - alturaAntes.current;
    else if (presoNoFim.current) irParaFim();
    primeiroId.current = novoPrimeiro;
    alturaAntes.current = virtual.getTotalSize();
    lerSeVisivel();
  }, [mensagens, pendentes, virtual, irParaFim, lerSeVisivel]);

  // Alturas reais (Markdown, KaTeX) e o teclado do celular mudam o tamanho: mantém o fim.
  // Observa o conteúdo interno pelo próprio feed, que existe desde a montagem.
  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (presoNoFim.current) irParaFim();
      alturaAntes.current = virtual.getTotalSize();
    });
    obs.observe(el);
    const conteudo = el.querySelector("[data-lista]");
    if (conteudo) obs.observe(conteudo);
    return () => obs.disconnect();
  }, [virtual, irParaFim, mensagens.length > 0]);

  // Saiu da aba: o que chegar depois vira "novo". Voltou: marca lido se estiver no fim.
  useEffect(() => {
    const aoMudar = () => {
      if (document.hidden) setMarco((m) => Math.max(m, ultimoId));
      else lerSeVisivel();
    };
    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, [ultimoId, lerSeVisivel]);

  function aoRolar() {
    const el = feed.current;
    if (!el) return;
    const fim = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM;
    presoNoFim.current = fim;
    if (fim !== noFim) setNoFim(fim);
    if (fim) lerSeVisivel();
  }

  // Leitor de tela anuncia só a última mensagem de outra pessoa.
  const ultima = mensagens.at(-1);
  const anuncio = ultima && ultima.de !== eu ? `${ultima.de}: ${ultima.texto.slice(0, 200)}` : "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={feed} onScroll={aoRolar} role="log" aria-live="off" aria-label={t.rotulo} tabIndex={0}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:p-6">
        <div className="mb-3 flex min-h-px justify-center text-xs text-muted-foreground">
          {temMais ? (
            <Button variant="outline" size="sm" className="rounded-full" disabled={carregandoAntigas} onClick={carregarAntigas}>
              {carregandoAntigas ? t.carregandoAntigas : t.verMais}
            </Button>
          ) : mensagens.length > 0 ? t.inicio : null}
        </div>
        {carregando && mensagens.length === 0 ? (
          <div className="grid gap-4" aria-label={t.carregandoMensagens}>
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
        ) : itens.length === 0 ? (
          <div className="mx-auto mt-[20vh] max-w-80 text-center text-muted-foreground">
            <h2 className="mb-1.5 text-[15px] font-semibold text-foreground">{t.vazioTitulo}</h2>
            {t.vazioTexto(sala)}
          </div>
        ) : (
          <div data-lista className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const it = itens[v.index];
              if (!it) return null;
              return (
                <div key={v.key} data-index={v.index} ref={virtual.measureElement}
                  className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${v.start}px)` }}>
                  {it.tipo === "divisor" ? (
                    <div role="separator" aria-label={t.novas} className="flex items-center gap-3 text-xs font-medium text-primary">
                      <span className="h-px flex-1 bg-primary/40" />{t.novas}<span className="h-px flex-1 bg-primary/40" />
                    </div>
                  ) : it.tipo === "msg" ? (
                    <Mensagem m={it.m} minha={it.m.de === eu} mencionaMe={mencao.test(it.m.texto)}
                      vistoPor={vistoEm.get(it.m.id)} vistaPorTodos={it.m.de === eu ? vistaPorTodos(it.m.id) : undefined}
                      citada={it.m.reply_to ? porId.get(it.m.reply_to) : undefined}
                      podeApagar={admin || it.m.de === eu} aoResponder={aoResponder} aoApagar={apagar} />
                  ) : (
                    <Mensagem
                      m={{ id: -1, de: it.p.de, para: null, texto: it.p.texto, criado_em: it.p.criado_em, reply_to: it.p.reply_to, anexos: it.p.anexos }}
                      citada={it.p.reply_to ? porId.get(it.p.reply_to) : undefined}
                      minha estado={it.p.estado}
                      aoTentar={() => retentar(it.p.client_id)} aoDescartar={() => descartar(it.p.client_id)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!noFim && (
        <Button size="sm" variant={novasAbaixo > 0 ? "default" : "secondary"} onClick={() => { presoNoFim.current = true; irParaFim(); }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg">
          <ArrowDownIcon /> {novasAbaixo > 0 ? t.novasAbaixo(novasAbaixo) : t.irParaFim}
        </Button>
      )}
      <Digitando nomes={digitando} />
      <div className="sr-only" aria-live="polite">{anuncio}</div>
    </div>
  );
}
