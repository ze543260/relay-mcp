import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { EstadoStatus, ModoStatus } from "@/shared/api/tipos";
import { textos } from "@/shared/lib/textos";
import { PontoStatus } from "./PontoStatus";
import { useDefinirStatus, useMeuStatus } from "./status";

const t = textos.status;
const MODOS: ModoStatus[] = ["auto", "ausente", "ocupado", "invisivel"];
const estadoDoModo = (m: ModoStatus): EstadoStatus => (m === "auto" ? "online" : m === "invisivel" ? "offline" : m);

/** Até a meia-noite de hoje, em segundos (opção "Hoje"). */
const ateMeiaNoite = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return Math.max(60, Math.round((d.getTime() - Date.now()) / 1000));
};

/** Botão de status no rodapé da lateral: escolher o modo (Disponível, Ausente, Não perturbe, Invisível)
 * e a mensagem com emoji e prazo, como no Discord/Teams. */
export function MeuStatus({ ativo }: { ativo: boolean }) {
  const { data: st } = useMeuStatus(ativo);
  const definir = useDefinirStatus();
  const [editando, setEditando] = useState(false);
  if (!st) return null;
  const estado: EstadoStatus = st.modo === "invisivel" ? "offline" : st.estado;
  const rotulo = st.texto || st.emoji ? [st.emoji, st.texto].filter(Boolean).join(" ") : t.modos[st.modo];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton size="sm" className="text-muted-foreground" aria-label={t.seu(t.modos[st.modo]!)} />}>
          <PontoStatus estado={estado} comRotulo={false} />
          <span className="min-w-0 flex-1 truncate">{rotulo}</span>
          {st.expira_em && <span className="text-[11px]">{t.ate(new Date(st.expira_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t.titulo}</DropdownMenuLabel>
            {MODOS.map((m) => (
              <DropdownMenuItem key={m} onClick={() => definir.mutate({ modo: m })} className="items-start">
                <PontoStatus estado={estadoDoModo(m)} comRotulo={false} className="mt-1" />
                <span className="grid">
                  <span>{t.modos[m]}</span>
                  <span className="text-xs text-muted-foreground">{t.dicas[m]}</span>
                </span>
                {st.modo === m && <CheckIcon className="ml-auto" aria-label="atual" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditando(true)}><PencilIcon />{st.texto || st.emoji ? t.editarMensagem : t.definirMensagem}</DropdownMenuItem>
          {(st.texto || st.emoji) && (
            <DropdownMenuItem onClick={() => definir.mutate({ texto: null, emoji: null })}><XIcon />{t.limpar}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {editando && <EditarMensagem inicial={{ texto: st.texto ?? "", emoji: st.emoji ?? "" }} aoFechar={() => setEditando(false)}
        aoSalvar={(texto, emoji, dura) => { definir.mutate({ texto, emoji, dura_s: dura }); setEditando(false); }} />}
    </>
  );
}

const SUGESTOES = [["📅", "Em reunião"], ["🍽️", "Almoçando"], ["🎧", "Focado"], ["🤒", "Doente"], ["🏖️", "De folga"]] as const;

function EditarMensagem({ inicial, aoFechar, aoSalvar }: {
  inicial: { texto: string; emoji: string }; aoFechar: () => void; aoSalvar: (texto: string, emoji: string, dura: number) => void;
}) {
  const [texto, setTexto] = useState(inicial.texto);
  const [emoji, setEmoji] = useState(inicial.emoji);
  const [dura, setDura] = useState(0);
  return (
    <Dialog open onOpenChange={(a) => { if (!a) aoFechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.definirMensagem}</DialogTitle>
          <DialogDescription>{t.placeholder}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); aoSalvar(texto.trim(), emoji.trim(), dura === -1 ? ateMeiaNoite() : dura); }}>
          <div className="flex gap-2">
            <div className="grid w-16 gap-1">
              <Label htmlFor="st-emoji">{t.emoji}</Label>
              <Input id="st-emoji" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} className="text-center" />
            </div>
            <div className="grid flex-1 gap-1">
              <Label htmlFor="st-texto">{t.mensagem}</Label>
              <Input id="st-texto" value={texto} maxLength={80} autoFocus placeholder={t.placeholder} onChange={(e) => setTexto(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGESTOES.map(([e, s]) => (
              <Button key={s} type="button" size="sm" variant="outline" onClick={() => { setEmoji(e); setTexto(s); }}>{e} {s}</Button>
            ))}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="st-dura">{t.durante}</Label>
            <NativeSelect id="st-dura" value={String(dura)} onChange={(e) => setDura(Number(e.target.value))}>
              {t.duracoes.map(([r, s]) => <option key={s} value={s}>{r}</option>)}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={aoFechar}>{t.cancelar}</Button>
            <Button type="submit">{t.salvar}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
