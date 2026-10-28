import { CornerUpLeftIcon, FileIcon, PaperclipIcon, SendHorizontalIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ehImagem, subirArquivo, tamanhoLegivel } from "@/shared/api/arquivos";
import { traduzirErro } from "@/shared/api/erros";
import type { Anexo, Mensagem } from "@/shared/api/tipos";
import { corDe, ehIa, resumo, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

export interface Candidato {
  nome: string;
  online: boolean;
}

interface Props {
  sala: string;
  /** Nome amigável no placeholder (ex.: canal de reunião). */
  rotuloSala?: string;
  nome: string;
  respondendo: Mensagem | null;
  /** Quem pode ser mencionado: participantes da sala + online. */
  candidatos: Candidato[];
  aoCancelarResposta: () => void;
  aoEnviar: (texto: string, replyTo?: number, anexos?: Anexo[]) => void;
  /** Chamado ao digitar (com texto) e ao esvaziar/enviar (para o "digitando…" dos outros). */
  aoDigitar?: (digitando: boolean) => void;
}

/** Arquivo escolhido: sobe na hora; o envio espera todos terminarem. */
interface Item {
  chave: string;
  arquivo: File;
  previa: string | null;
  progresso: number;
  anexo?: Anexo;
  erro?: string;
}

const MAX_ANEXOS = 10;

const toque = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
const t = textos.composer;
const MAX_SUGESTOES = 6;

/** `@parcial` imediatamente antes do cursor (início do texto ou depois de espaço/pontuação). */
function mencaoNoCursor(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const m = /(^|[\s(])@([\w.-]{0,32})$/.exec(texto.slice(0, cursor));
  return m ? { inicio: cursor - m[2]!.length - 1, termo: m[2]!.toLowerCase() } : null;
}

/** Envio é otimista (useConversa): limpa na hora e a mensagem aparece como "enviando…". */
export function Composer({ sala, rotuloSala, nome, respondendo, candidatos, aoCancelarResposta, aoEnviar, aoDigitar }: Props) {
  const [texto, setTexto] = useState("");
  const [cursor, setCursor] = useState(0);
  const [indice, setIndice] = useState(0);
  const [fechada, setFechada] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const idLista = useId();
  const [itens, setItens] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const subindo = itens.some((i) => !i.anexo && !i.erro);
  const prontos = itens.filter((i) => i.anexo).map((i) => i.anexo!);

  function adicionar(arquivos: File[]) {
    const novos = arquivos.slice(0, MAX_ANEXOS - itens.length).map((arquivo): Item => ({
      chave: `${arquivo.name}-${arquivo.size}-${Math.random()}`,
      arquivo,
      previa: ehImagem(arquivo.type) ? URL.createObjectURL(arquivo) : null,
      progresso: 0,
    }));
    if (!novos.length) return;
    setItens((atual) => [...atual, ...novos]);
    for (const n of novos) {
      subirArquivo(n.arquivo, (f) => setItens((xs) => xs.map((x) => (x.chave === n.chave ? { ...x, progresso: f } : x))))
        .then((anexo) => setItens((xs) => xs.map((x) => (x.chave === n.chave ? { ...x, anexo, progresso: 1 } : x))))
        .catch((e: unknown) => setItens((xs) => xs.map((x) => (x.chave === n.chave ? { ...x, erro: traduzirErro(e).mensagem } : x))));
    }
    ref.current?.focus();
  }

  function remover(chave: string) {
    setItens((xs) => {
      const it = xs.find((x) => x.chave === chave);
      if (it?.previa) URL.revokeObjectURL(it.previa);
      return xs.filter((x) => x.chave !== chave);
    });
  }

  // Arrastar arquivo para qualquer lugar da sala.
  useEffect(() => {
    const temArquivo = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    let profundidade = 0;
    const entrar = (e: DragEvent) => { if (temArquivo(e)) { profundidade++; setArrastando(true); } };
    const sair = () => { profundidade = Math.max(0, profundidade - 1); if (!profundidade) setArrastando(false); };
    const sobre = (e: DragEvent) => { if (temArquivo(e)) e.preventDefault(); };
    const soltar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade = 0;
      setArrastando(false);
      adicionar(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", entrar);
    window.addEventListener("dragleave", sair);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", soltar);
    return () => {
      window.removeEventListener("dragenter", entrar);
      window.removeEventListener("dragleave", sair);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", soltar);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps

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
    if ((!conteudo && !prontos.length) || subindo) return;
    aoEnviar(conteudo, respondendo?.id, prontos.length ? prontos : undefined);
    aoDigitar?.(false);
    setTexto("");
    itens.forEach((i) => i.previa && URL.revokeObjectURL(i.previa));
    setItens([]);
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
    aoDigitar?.(valor.trim().length > 0);
    setTexto(valor);
    setCursor(pos);
    setIndice(0);
    setFechada(false);
  }

  const podeEnviar = (texto.trim().length > 0 || prontos.length > 0) && !subindo;
  return (
    <div className="relative border-t">
      {arrastando && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="grid place-items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-8 text-sm font-medium">
            <UploadIcon className="size-6 text-primary" />{t.soltar}
          </div>
        </div>
      )}
      {itens.length > 0 && (
        <ul aria-label={t.anexos} className="flex gap-2 overflow-x-auto px-3 pt-2 md:px-6">
          {itens.map((i) => (
            <li key={i.chave} className={cn("relative flex h-16 flex-none items-center gap-2 overflow-hidden rounded-[var(--raio-xl)] border bg-card pr-8",
              i.previa ? "w-16 pr-0" : "max-w-56 pl-3", i.erro && "border-destructive/60")}>
              {i.previa ? <img src={i.previa} alt={i.arquivo.name} className="size-full object-cover" />
                : <><FileIcon className="size-5 flex-none text-primary" aria-hidden />
                  <span className="grid min-w-0 leading-tight"><span className="truncate text-xs font-medium">{i.arquivo.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{i.erro ?? tamanhoLegivel(i.arquivo.size)}</span></span></>}
              {!i.anexo && !i.erro && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-border" role="progressbar" aria-valuenow={Math.round(i.progresso * 100)} aria-label={t.enviando(i.arquivo.name)}>
                  <span className="block h-full bg-primary transition-[width]" style={{ width: `${i.progresso * 100}%` }} />
                </span>
              )}
              {i.erro && i.previa && <span className="absolute inset-0 grid place-items-center bg-destructive/70 text-[10px] font-medium text-white">{t.falhou}</span>}
              <button type="button" onClick={() => remover(i.chave)} aria-label={t.remover(i.arquivo.name)}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background">
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
        <input ref={seletor} type="file" multiple hidden onChange={(e) => { adicionar(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <Button type="button" variant="ghost" size="icon" aria-label={t.anexar} title={t.anexar} disabled={itens.length >= MAX_ANEXOS}
          onClick={() => seletor.current?.click()} className="size-11 flex-none rounded-full text-muted-foreground md:size-10">
          <PaperclipIcon className="size-5" />
        </Button>
        <label htmlFor="entrada" className="sr-only">{t.rotulo}</label>
        <Textarea id="entrada" ref={ref} rows={1} value={texto} placeholder={rotuloSala ? t.placeholderReuniao(nome, rotuloSala) : t.placeholder(nome, sala)}
          role="combobox" aria-expanded={aberta} aria-controls={aberta ? idLista : undefined} aria-autocomplete="list"
          aria-activedescendant={aberta ? `${idLista}-${ativo}` : undefined}
          onChange={(e) => atualizar(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onBlur={() => setFechada(true)} onFocus={() => setFechada(false)}
          onPaste={(e) => {
            const arquivos = Array.from(e.clipboardData.files);
            if (arquivos.length) { e.preventDefault(); adicionar(arquivos); }
          }}
          onKeyDown={aoTeclar}
          className="max-h-45 min-h-11 flex-1 resize-none rounded-[20px] bg-card px-3.5 py-2.5 text-base md:min-h-10 md:rounded-lg md:text-sm" />
        <Button type="submit" disabled={!podeEnviar} aria-label={t.enviar}
          className="size-11 flex-none rounded-full md:h-10 md:w-auto md:rounded-lg md:px-4">
          <span className="hidden md:inline">{t.enviar}</span>
          <SendHorizontalIcon className="size-4.5 md:hidden" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
