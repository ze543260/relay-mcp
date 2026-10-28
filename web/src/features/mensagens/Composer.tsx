import { SendHorizontalIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { textos } from "@/shared/lib/textos";

interface Props {
  sala: string;
  nome: string;
  aoEnviar: (texto: string) => void;
}

const toque = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
const t = textos.composer;

/** Envio é otimista (useConversa): limpa na hora e a mensagem aparece como "enviando…". */
export function Composer({ sala, nome, aoEnviar }: Props) {
  const [texto, setTexto] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function enviar(e?: FormEvent) {
    e?.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo) return;
    aoEnviar(conteudo);
    setTexto("");
    ref.current?.focus();
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    // No toque, Enter quebra linha (envia pelo botão); no teclado físico, Shift+Enter quebra.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !toque?.matches) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <form onSubmit={enviar}
      className="flex items-end gap-2 border-t px-3 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-3">
      <label htmlFor="entrada" className="sr-only">{t.rotulo}</label>
      <Textarea id="entrada" ref={ref} rows={1} value={texto} placeholder={t.placeholder(nome, sala)}
        onChange={(e) => setTexto(e.target.value)} onKeyDown={aoTeclar}
        className="max-h-45 min-h-11 flex-1 resize-none rounded-[20px] bg-card px-3.5 py-2.5 text-base md:min-h-10 md:rounded-lg md:text-sm" />
      <Button type="submit" disabled={!texto.trim()} aria-label={t.enviar}
        className="size-11 flex-none rounded-full md:h-10 md:w-auto md:rounded-lg md:px-4">
        <span className="hidden md:inline">{t.enviar}</span>
        <SendHorizontalIcon className="size-4.5 md:hidden" aria-hidden />
      </Button>
    </form>
  );
}
