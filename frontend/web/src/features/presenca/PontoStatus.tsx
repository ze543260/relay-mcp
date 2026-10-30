import { cn } from "@/lib/utils";
import type { EstadoStatus } from "@/shared/api/tipos";
import { textos } from "@/shared/lib/textos";
import { COR_ESTADO } from "./status";

/** Ponto de status por cima do avatar (ou solto). A forma muda junto com a cor, pra não depender só da cor:
 * online = cheio, ausente = lua, ocupado = traço, offline = vazado. */
export function PontoStatus({ estado, className, comRotulo = true }: { estado: EstadoStatus; className?: string; comRotulo?: boolean }) {
  const cor = COR_ESTADO[estado];
  return (
    <span role={comRotulo ? "img" : undefined} aria-label={comRotulo ? textos.status.estados[estado] : undefined} aria-hidden={!comRotulo}
      className={cn("relative inline-block size-2.5 flex-none rounded-full ring-2 ring-background", className)}
      style={{ background: estado === "offline" ? "var(--background)" : cor, boxShadow: estado === "offline" ? `inset 0 0 0 2px ${cor}` : undefined }}>
      {estado === "ausente" && <span className="absolute -top-px -left-px size-[60%] rounded-full bg-background" />}
      {estado === "ocupado" && <span className="absolute top-1/2 left-1/2 h-[2px] w-[60%] -translate-1/2 rounded-full bg-background" />}
    </span>
  );
}
