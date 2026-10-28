import { ChevronsUpDownIcon, HashIcon, LogOutIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import type { EstadoConexao } from "@/features/mensagens/useConversa";
import { cn } from "@/lib/utils";
import { corDe, siglaDe } from "@/shared/lib/formato";
import { useSalas } from "./useSalas";

interface Props {
  sala: string;
  nome: string;
  vistas: Record<string, number>;
  estado: EstadoConexao;
  aoEscolher: (sala: string) => void;
  aoSair: () => void;
}

function textoEstado(e: EstadoConexao): string {
  switch (e.tipo) {
    case "carregando": return "carregando…";
    case "ao-vivo": return "ao vivo";
    case "reconectando": return `reconectando em ${e.emSegundos} s`;
    case "sem-acesso": return "sem acesso";
  }
}

export function BarraLateral({ sala, nome, vistas, estado, aoEscolher, aoSair }: Props) {
  const { data, isPending } = useSalas();
  const { isMobile, setOpenMobile } = useSidebar();
  const lista = data ?? [];
  const salas = lista.some((s) => s.sala === sala) ? lista : [{ sala, total: 0, agentes: [] }, ...lista];
  const vivo = estado.tipo === "ao-vivo";

  const escolher = (s: string) => {
    if (isMobile) setOpenMobile(false);
    aoEscolher(s);
  };

  return (
    <Sidebar collapsible="icon" className="pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={`Relay · ${textoEstado(estado)}`} className="cursor-default hover:bg-transparent active:bg-transparent">
              <span className="relative grid size-8 flex-none place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <HashIcon className="size-4" />
                <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
                  vivo ? "bg-ok motion-safe:animate-[pulso_2s_infinite]" : "bg-muted-foreground")} />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="font-semibold tracking-tight">Relay</span>
                <span className="truncate text-xs text-muted-foreground" aria-live="polite">{textoEstado(estado)}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Salas</SidebarGroupLabel>
          <SidebarMenu aria-label="Lista de salas">
            {isPending && Array.from({ length: 3 }, (_, i) => (
              <SidebarMenuItem key={i}><SidebarMenuSkeleton showIcon /></SidebarMenuItem>
            ))}
            {!isPending && salas.map((s) => {
              const ativa = s.sala === sala;
              // Não lidas só quando o servidor manda ultimo_id (contrato novo).
              const naoLida = !ativa && s.ultimo_id !== undefined && s.ultimo_id > (vistas[s.sala] ?? 0);
              return (
                <SidebarMenuItem key={s.sala}>
                  <SidebarMenuButton size="lg" isActive={ativa} tooltip={`#${s.sala}`} onClick={() => escolher(s.sala)}
                    aria-current={ativa ? "page" : undefined}>
                    <HashIcon />
                    <span className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate font-medium">{s.sala}</span>
                      <span className="truncate text-xs text-muted-foreground">{s.agentes.filter(Boolean).join(", ") || "vazia"}</span>
                    </span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className={cn("group-data-[collapsible=icon]:hidden", naoLida && "bg-sidebar-primary text-sidebar-primary-foreground peer-hover/menu-button:text-sidebar-primary-foreground")}
                    aria-label={naoLida ? `${s.total} mensagens, há não lidas` : `${s.total} mensagens`}>
                    {s.total}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
                <Avatar className="rounded-lg after:rounded-lg">
                  <AvatarFallback className="rounded-lg text-[11px] font-semibold text-white" style={{ background: corDe(nome) }}>
                    {siglaDe(nome)}
                  </AvatarFallback>
                </Avatar>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{nome}</span>
                  <span className="truncate text-xs text-muted-foreground">humano</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Conectado como {nome}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={aoSair}>
                  <LogOutIcon /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
