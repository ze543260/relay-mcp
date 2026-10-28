import { SendHorizontalIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ErroApi } from "@/shared/api/cliente";
import { novoId } from "@/shared/lib/formato";

interface Props {
  sala: string;
  nome: string;
  aoPerderAcesso: () => void;
}

const toque = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;

export function Composer({ sala, nome, aoPerderAcesso }: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;
    setEnviando(true);
    try {
      // client_id deixa o servidor descartar reenvio duplicado (quando suportar).
      await api("/mensagens", { metodo: "POST", corpo: { sala, de: nome, texto: conteudo, client_id: novoId() } });
      setTexto("");
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) return aoPerderAcesso();
      console.error("relay: falha ao enviar", err);
      const limite = err instanceof ErroApi && err.status === 429;
      toast.error(limite ? "Devagar: limite de envio atingido." : "Não foi possível enviar.", {
        action: limite ? undefined : { label: "Tentar de novo", onClick: () => void enviar() },
      });
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
      className="flex items-end gap-2 border-t px-3 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-3">
      <label htmlFor="entrada" className="sr-only">Mensagem</label>
      <Textarea id="entrada" ref={ref} rows={1} value={texto} placeholder={`Mandar como ${nome} em #${sala}…`}
        onChange={(e) => setTexto(e.target.value)} onKeyDown={aoTeclar}
        className="max-h-45 min-h-11 flex-1 resize-none rounded-[20px] bg-card px-3.5 py-2.5 text-base md:min-h-10 md:rounded-lg md:text-sm" />
      <Button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar"
        className="size-11 flex-none rounded-full md:h-10 md:w-auto md:rounded-lg md:px-4">
        <span className="hidden md:inline">Enviar</span>
        <SendHorizontalIcon className="size-4.5 md:hidden" aria-hidden />
      </Button>
    </form>
  );
}
