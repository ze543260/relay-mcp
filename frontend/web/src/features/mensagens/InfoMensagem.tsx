import { CheckCheckIcon, ClockIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FotoPerfil } from "@/features/perfil/FotoPerfil";
import type { Mensagem } from "@/shared/api/tipos";
import { cn } from "@/lib/utils";
import { corDe, ehIa, horaDe, instanteDe, siglaDe } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

const t = textos.conversa;

function Pessoa({ nome, apelido }: { nome: string; apelido?: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <Avatar aria-hidden className={cn("size-9", !ehIa(nome) && "rounded-lg after:rounded-lg")}>
        <FotoPerfil nome={nome} className={cn(!ehIa(nome) && "rounded-lg")} />
        <AvatarFallback className={cn("text-xs font-semibold text-white", !ehIa(nome) && "rounded-lg")} style={{ background: corDe(nome) }}>
          {siglaDe(nome)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{apelido ?? nome}</span>
    </li>
  );
}

/** "Dados da mensagem" (estilo WhatsApp): quem já leu e quem ainda não, numa tela à parte. */
export function InfoMensagem({ m, leituras, apelidos, fechar }: {
  m: Mensagem | null; leituras: Map<string, number>; apelidos: Map<string, string>; fechar: () => void;
}) {
  const outros = m ? [...leituras.keys()].filter((n) => n !== m.de).sort() : [];
  const leram = m ? outros.filter((n) => (leituras.get(n) ?? 0) >= m.id) : [];
  const faltam = outros.filter((n) => !leram.includes(n));
  return (
    <Sheet open={m !== null} onOpenChange={(aberto) => { if (!aberto) fechar(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-sm">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>{t.infoTitulo}</SheetTitle>
          <SheetDescription className="sr-only">{t.infoDescricao}</SheetDescription>
        </SheetHeader>
        {m && (
          <div className="grid gap-6 p-4">
            <figure className="ml-auto max-w-[90%] rounded-xl rounded-tr-sm bg-acento-fundo px-3 py-2 text-sm">
              <p className="line-clamp-6 whitespace-pre-wrap break-words">{m.texto || "📎"}</p>
              <figcaption className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">{horaDe(instanteDe(m))}</figcaption>
            </figure>
            <section aria-labelledby="info-leram">
              <h3 id="info-leram" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                <CheckCheckIcon className="size-4" aria-hidden />{t.lidaPor(leram.length)}
              </h3>
              {leram.length ? <ul>{leram.map((n) => <Pessoa key={n} nome={n} apelido={apelidos.get(n)} />)}</ul>
                : <p className="text-sm text-muted-foreground">{t.ninguemLeu}</p>}
            </section>
            {faltam.length > 0 && (
              <section aria-labelledby="info-faltam">
                <h3 id="info-faltam" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClockIcon className="size-4" aria-hidden />{t.naoLeram(faltam.length)}
                </h3>
                <ul>{faltam.map((n) => <Pessoa key={n} nome={n} apelido={apelidos.get(n)} />)}</ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
