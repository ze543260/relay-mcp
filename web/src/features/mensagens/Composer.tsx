import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ErroApi } from "../../shared/api/cliente";
import { novoId } from "../../shared/lib/formato";

interface Props {
  sala: string;
  nome: string;
  aoFalhar: (texto: string) => void;
  aoPerderAcesso: () => void;
}

const toque = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
const ALTURA_MAX = 180;

export function Composer({ sala, nome, aoFalhar, aoPerderAcesso }: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function ajustarAltura() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAX)}px`;
    el.style.overflowY = el.scrollHeight > ALTURA_MAX ? "auto" : "hidden";
  }

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;
    setEnviando(true);
    try {
      // client_id deixa o servidor descartar reenvio duplicado (quando suportar).
      await api("/mensagens", { metodo: "POST", corpo: { sala, de: nome, texto: conteudo, client_id: novoId() } });
      setTexto("");
      requestAnimationFrame(ajustarAltura);
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) return aoPerderAcesso();
      console.error("relay: falha ao enviar", err);
      aoFalhar(err instanceof ErroApi && err.status === 429 ? "devagar: limite de envio" : "falha ao enviar");
    } finally {
      setEnviando(false);
      ref.current?.focus();
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    // No toque, Enter quebra linha (envia pelo botão); no teclado físico, Shift+Enter quebra.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !toque?.matches) {
      e.preventDefault();
      void enviar();
    }
  }

  return (
    <form onSubmit={enviar}
      className="flex items-end gap-2 border-t border-borda px-3 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-3">
      <label htmlFor="entrada" className="sr-only">Mensagem</label>
      <textarea id="entrada" ref={ref} rows={1} value={texto} placeholder={`Mandar como ${nome} em #${sala}…`}
        onChange={(e) => { setTexto(e.target.value); ajustarAltura(); }} onKeyDown={aoTeclar}
        className="max-h-[180px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-[20px] border border-borda bg-painel px-3.5 py-2.5 text-base leading-snug outline-none focus:border-acento md:rounded-[10px] md:text-sm" />
      <button disabled={enviando || !texto.trim()} aria-label="Enviar"
        className="grid size-11 flex-none place-items-center rounded-full bg-acento font-medium text-white disabled:opacity-50 md:h-auto md:min-h-10 md:w-auto md:rounded-[10px] md:px-4">
        <span className="hidden md:inline">Enviar</span>
        <svg className="md:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
