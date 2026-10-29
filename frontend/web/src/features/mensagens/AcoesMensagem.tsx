import { CopyIcon, CornerUpLeftIcon, EllipsisIcon, InfoIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Mensagem } from "@/shared/api/tipos";
import { avisar } from "@/shared/lib/avisar";
import { textos } from "@/shared/lib/textos";

const t = textos.conversa;

interface Props {
  m: Mensagem;
  podeApagar: boolean;
  classeGatilho: string;
  aoResponder?: (m: Mensagem) => void;
  aoApagar?: (id: number) => void;
  aoEditar?: () => void;
  aoInfo?: () => void;
}

/** Carregado sob demanda no 1º clique em "⋯" (Menu + AlertDialog fora do bundle inicial). Já abre aberto. */
export default function AcoesMensagem({ m, podeApagar, classeGatilho, aoResponder, aoApagar, aoEditar, aoInfo }: Props) {
  const [confirmando, setConfirmando] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(m.texto);
      avisar("sucesso", t.copiada);
    } catch {
      avisar("erro", t.naoCopiou);
    }
  }

  return (
    <>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t.acoes} className={classeGatilho} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onClick={() => aoResponder?.(m)}><CornerUpLeftIcon /> {t.responder}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copiar()}><CopyIcon /> {t.copiar}</DropdownMenuItem>
          {aoEditar && <DropdownMenuItem onClick={aoEditar}><PencilIcon /> {t.editar}</DropdownMenuItem>}
          {aoInfo && <DropdownMenuItem onClick={aoInfo}><InfoIcon /> {t.infoTitulo}</DropdownMenuItem>}
          {podeApagar && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmando(true)}><Trash2Icon /> {t.apagar}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.apagarTitulo}</AlertDialogTitle>
            <AlertDialogDescription>{t.apagarDescricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => aoApagar?.(m.id)}>{t.apagar}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
