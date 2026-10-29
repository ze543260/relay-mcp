import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { corDe, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { marcar, textoPlano, useBuscaSala } from "./api";

const t = textos.buscaSala;
const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Busca nas mensagens da sala; escolher pula até a mensagem na conversa (com as de antes e depois). */
export default function BuscaSala({ sala, aberta, setAberta, aoIrPara }: {
  sala: string; aberta: boolean; setAberta: (a: boolean) => void; aoIrPara: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const termo = q.trim();
  const { data, isFetching } = useBuscaSala(sala, termo);
  const lista = termo.length >= 2 ? data?.mensagens ?? [] : [];
  const ir = (id: number) => { setAberta(false); setQ(""); aoIrPara(id); };
  return (
    <CommandDialog open={aberta} onOpenChange={setAberta} title={t.abrir(sala)} description={t.dica} className="sm:max-w-xl">
      <Command shouldFilter={false} className="motion-safe:animate-[paleta_150ms_cubic-bezier(.2,0,0,1)]">
        <CommandInput value={q} onValueChange={setQ} placeholder={t.placeholder(sala)} />
        <CommandList className="max-h-[min(60vh,28rem)]">
          {isFetching && <LoaderIcon aria-hidden className="absolute top-3.5 right-4 size-4 animate-spin text-muted-foreground" />}
          <span className="sr-only" aria-live="polite">{termo.length >= 2 && data ? t.resultados(data.mensagens.length, data.tem_mais) : ""}</span>
          {termo.length < 2 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t.dica}</p>}
          {termo.length >= 2 && data && !lista.length && <CommandEmpty>{t.vazio}</CommandEmpty>}
          {lista.length > 0 && (
            <CommandGroup heading={t.resultados(lista.length, !!data?.tem_mais)}>
              {lista.map((m) => (
                <CommandItem key={m.id} value={String(m.id)} onSelect={() => ir(m.id)} className="items-start">
                  <span aria-hidden className="mt-0.5 grid size-6 flex-none place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: corDe(m.de) }}>
                    {siglaDe(m.de)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">{m.de} · {fmt.format(m.criado_em ? new Date(m.criado_em) : new Date((m.criado ?? 0) * 1000))}</span>
                    <span className="line-clamp-3">
                      {marcar(textoPlano(m.texto), termo).map((p, i) => p.achou ? <mark key={i} className="rounded-sm bg-acento-fundo text-foreground">{p.t}</mark> : p.t)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
