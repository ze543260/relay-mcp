import { OctagonAlertIcon, SignalHighIcon, SignalLowIcon, SignalMediumIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import type { Etiqueta, Prioridade } from "./api";

const t = textos.equipe;

const ICONES = { urgente: OctagonAlertIcon, alta: SignalHighIcon, media: SignalMediumIcon, baixa: SignalLowIcon } as const;

/** Ícone da prioridade; "nenhuma" não desenha nada (o cartão fica limpo). */
export function IconePrioridade({ prioridade, className }: { prioridade: Prioridade; className?: string }) {
  if (prioridade === "nenhuma") return null;
  const Icone = ICONES[prioridade];
  return (
    <Icone role="img" aria-label={t.prioridades[prioridade]}
      className={cn("size-3.5 flex-none", prioridade === "urgente" ? "text-destructive" : "text-muted-foreground", className)} />
  );
}

/** Pílula da etiqueta com a cor dos tokens --agente-N; com `remover`, ganha um X. */
export function ChipEtiqueta({ etiqueta, remover }: { etiqueta: Pick<Etiqueta, "nome" | "cor">; remover?: () => void }) {
  const cor = `var(--agente-${etiqueta.cor % 8})`;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] leading-4 font-medium"
      style={{ borderColor: `color-mix(in oklab, ${cor} 45%, transparent)`, background: `color-mix(in oklab, ${cor} 12%, transparent)` }}>
      <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: cor }} />
      <span className="truncate">{etiqueta.nome}</span>
      {remover && (
        <button type="button" onClick={remover} aria-label={t.painel.removerEtiqueta(etiqueta.nome)}
          className="-mr-0.5 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
