import { CornerUpLeftIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Mensagem } from "@/shared/api/tipos";
import { corDe, ehIa, resumo, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

export interface Candidato {
  nome: string;
  online: boolean;
}

interface Props {
  sala: string;
  nome: string;
  respondendo: Mensagem | null;
  /** Quem pode ser mencionado: participantes da sala + online. */
  candidatos: Candidato[];
  aoCancelarResposta: () => void;
  aoEnviar: (texto: string, replyTo?: number) => void;
}

const toque = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
const t = textos.composer;
const MAX_SUGESTOES = 6;

/** `@parcial` imediatamente antes do cursor (início do texto ou depois de espaço/pontuação). */
function mencaoNoCursor(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const m = /(^|[\s(])@([\w.-]{0,32})$/.exec(texto.slice(0, cursor));
  return m ? { inicio: cursor - m[2]!.length - 1, termo: m[2]!.toLowerCase() } : null;
}

/** Envio é otimista (useConversa): limpa na hora e a mensagem aparece como "enviando…". */
export function Composer({ sala, nome, respondendo, candidatos, aoCancelarResposta, aoEnviar }: Props) {
  const [texto, setTexto] = useState("");
  const [cursor, setCursor] = useState(0);
  const [indice, setIndice] = useState(0);
  const [fechada, setFechada] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const idLista = useId();

  // Escolheu "Responder": foca a caixa.
  useEffect(() => { if (respondendo) ref.current?.focus(); }, [respondendo]);

  const mencao = mencaoNoCursor(texto, cursor);
  const sugestoes = useMemo(() => {
    if (!mencao) return [];
    return candidatos
      .filter((c) => c.nome !== nome && c.nome !== "relay" && c.nome.toLowerCase().includes(mencao.termo))
      // Começa com o termo > online > alfabética.
      .sort((a, b) => Number(b.nome.toLowerCase().startsWith(mencao.termo)) - Number(a.nome.toLowerCase().startsWith(mencao.termo))
        || Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome))
      .slice(0, MAX_SUGESTOES);
  }, [mencao?.termo, candidatos, nome]); // eslint-disable-line react-hooks/exhaustive-deps
  const aberta = sugestoes.length > 0 && !fechada;
  const ativo = Math.min(indice, sugestoes.length - 1);

  function escolher(c: Candidato) {
    if (!mencao) return;
    const novo = `${texto.slice(0, mencao.inicio)}@${c.nome} ${texto.slice(cursor)}`;
    const pos = mencao.inicio + c.nome.length + 2;
    setTexto(novo);
    setCursor(pos);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  }

  function enviar(e?: FormEvent) {
    e?.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo) return;
    aoEnviar(conteudo, respondendo?.id);
    setTexto("");
    setCursor(0);
    aoCancelarResposta();
    ref.current?.focus();
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (aberta) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        return setIndice((ativo + d + sugestoes.length) % sugestoes.length);
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        return escolher(sugestoes[ativo]!);
      }
      if (e.key === "Escape") { e.preventDefault(); return setFechada(true); }
    }
    // No toque, Enter quebra linha (envia pelo botão); no teclado físico, Shift+Enter quebra.
    if (e.key === "Escape" && respondendo) return aoCancelarResposta();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !toque?.matches) {
      e.preventDefault();
      enviar();
    }
  }

  function atualizar(valor: string, pos: number) {
    setTexto(valor);
    setCursor(pos);
    setIndice(0);
    setFechada(false);
  }

  return (
    <div className="relative border-t">
      {aberta && (
        <ul id={idLista} role="listbox" aria-label={t.mencionar}
          className="absolute bottom-full left-3 z-20 mb-2 w-[min(18rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg md:left-6">
          <li className="px-2 pt-1 pb-1.5 text-[11px] tracking-widest text-muted-foreground uppercase" aria-hidden>{t.mencionar}</li>
          {sugestoes.map((c, i) => (
            <li key={c.nome} id={`${idLista}-${i}`} role="option" aria-selected={i === ativo}
              onMouseDown={(e) => { e.preventDefault(); escolher(c); }} onMouseEnter={() => setIndice(i)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 md:min-h-9", i === ativo && "bg-accent")}>
              <Avatar aria-hidden className={cn("size-6", !ehIa(c.nome) && "rounded-md after:rounded-md")}>
                <AvatarFallback className={cn("text-[9.5px] font-semibold text-white", !ehIa(c.nome) && "rounded-md")} style={{ background: corDe(c.nome) }}>
                  {siglaDe(c.nome)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
              {c.online && <span className="flex items-center gap-1 text-xs text-ok"><i className="size-1.5 rounded-full bg-ok" />{textos.conversa.online}</span>}
            </li>
          ))}
        </ul>
      )}
      {respondendo && (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground md:px-6">
          <CornerUpLeftIcon className="size-3.5 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <b className="font-medium text-foreground">{t.respondendo(respondendo.de)}</b> · {resumo(respondendo.texto, 120)}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t.cancelarResposta} onClick={aoCancelarResposta}><XIcon /></Button>
        </div>
      )}
      <form onSubmit={enviar}
        className="flex items-end gap-2 px-3 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-3">
        <label htmlFor="entrada" className="sr-only">{t.rotulo}</label>
        <Textarea id="entrada" ref={ref} rows={1} value={texto} placeholder={t.placeholder(nome, sala)}
          role="combobox" aria-expanded={aberta} aria-controls={aberta ? idLista : undefined} aria-autocomplete="list"
          aria-activedescendant={aberta ? `${idLista}-${ativo}` : undefined}
          onChange={(e) => atualizar(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onBlur={() => setFechada(true)} onFocus={() => setFechada(false)}
          onKeyDown={aoTeclar}
          className="max-h-45 min-h-11 flex-1 resize-none rounded-[20px] bg-card px-3.5 py-2.5 text-base md:min-h-10 md:rounded-lg md:text-sm" />
        <Button type="submit" disabled={!texto.trim()} aria-label={t.enviar}
          className="size-11 flex-none rounded-full md:h-10 md:w-auto md:rounded-lg md:px-4">
          <span className="hidden md:inline">{t.enviar}</span>
          <SendHorizontalIcon className="size-4.5 md:hidden" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
