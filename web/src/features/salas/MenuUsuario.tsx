import { Link } from "@tanstack/react-router";
import { BellIcon, BellOffIcon, KeyRoundIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { Tema } from "@/shared/lib/tema";
import { textos } from "@/shared/lib/textos";

interface Props {
  nome: string;
  admin: boolean;
  tema: Tema;
  aoTema: (tema: Tema) => void;
  notificacoes: { ativas: boolean; negadas: boolean; alternar: () => void } | null;
  aoSair: () => void;
  isMobile: boolean;
  children: ReactNode;
}

const ehTema = (v: unknown): v is Tema => v === "sistema" || v === "claro" || v === "escuro";

export default function MenuUsuario({ nome, admin, tema, aoTema, notificacoes, aoSair, isMobile, children }: Props) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
        {children}
      </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{textos.sessao.conectadoComo(nome)}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">{textos.tema.titulo}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={tema} onValueChange={(v: unknown) => { if (ehTema(v)) aoTema(v); }}>
            <DropdownMenuRadioItem value="sistema"><MonitorIcon /> {textos.tema.sistema}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="claro"><SunIcon /> {textos.tema.claro}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="escuro"><MoonIcon /> {textos.tema.escuro}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {notificacoes && (
          <DropdownMenuItem disabled={notificacoes.negadas} onClick={notificacoes.alternar}>
            {notificacoes.ativas ? <BellOffIcon /> : <BellIcon />}
            {notificacoes.negadas ? textos.avisos.bloqueadas : notificacoes.ativas ? textos.avisos.desativar : textos.avisos.ativar}
          </DropdownMenuItem>
        )}
        {admin && (
          <DropdownMenuItem render={<Link to="/config" />}>
            <KeyRoundIcon /> {textos.config.abrir}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={aoSair}>
          <LogOutIcon /> {textos.sessao.sair}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
