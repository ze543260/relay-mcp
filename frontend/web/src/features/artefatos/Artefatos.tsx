import { FileCodeIcon, FileTextIcon, ImageIcon, LayoutTemplateIcon, WorkflowIcon } from "lucide-react";
import { useContext, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { textos } from "@/shared/lib/textos";
import { AbrirArtefatoContexto, useArtefatos, type EstadoArtefato, type TipoArtefato } from "./api";

const t = textos.artefatos;
export const ICONES: Record<TipoArtefato, typeof FileTextIcon> = { markdown: FileTextIcon, mermaid: WorkflowIcon, html: LayoutTemplateIcon, svg: ImageIcon };

/** Aba Artefatos: lista da sala, do mais recente; clicar abre o painel. */
export default function Artefatos({ sala }: { sala: string }) {
  const { data, isPending } = useArtefatos(sala);
  const abrir = useContext(AbrirArtefatoContexto);
  const [estado, setEstado] = useState<EstadoArtefato | "">("");
  const lista = (data ?? []).filter((a) => estado ? a.estado === estado : a.estado !== "arquivado");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <FileCodeIcon className="size-4 text-primary" aria-hidden />
        <NativeSelect value={estado} aria-label={t.filtroEstado} onChange={(e) => setEstado(e.target.value as EstadoArtefato | "")}>
          <option value="">{t.ativos}</option>
          <option value="rascunho">{t.estados.rascunho}</option>
          <option value="aprovado">{t.estados.aprovado}</option>
          <option value="arquivado">{t.estados.arquivado}</option>
        </NativeSelect>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-3xl gap-2">
          {isPending ? <><Skeleton className="h-16" /><Skeleton className="h-16" /></>
            : lista.length === 0 ? (
              <div className="mx-auto mt-[12vh] max-w-96 text-center text-muted-foreground">
                <FileCodeIcon className="mx-auto mb-3 size-8 opacity-50" aria-hidden />
                <h2 className="mb-1.5 text-[15px] font-semibold text-foreground">{t.vazio}</h2>
                <p className="text-sm">{t.vazioDica}</p>
              </div>
            ) : lista.map((a) => {
              const Icone = ICONES[a.tipo];
              return (
                <button key={a.id} type="button" onClick={() => abrir(a.id)}
                  className="flex items-start gap-3 rounded-[var(--raio-xl)] border bg-card p-3 text-left shadow-xs transition-colors hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring">
                  <Icone className="mt-0.5 size-5 flex-none text-primary" aria-hidden />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium">{a.titulo}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t.tipos[a.tipo]} · v{a.versao}{a.autor_versao ? ` · ${a.autor_versao}` : ""}{a.resumo ? ` · ${a.resumo}` : ""}
                    </span>
                  </span>
                  <Badge variant={a.estado === "aprovado" ? "default" : "outline"} className={cn(a.estado === "arquivado" && "opacity-60")}>
                    {t.estados[a.estado]}
                  </Badge>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
