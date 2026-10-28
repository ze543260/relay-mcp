import { lazy, Suspense, useState } from "react";
import { CalendarClockIcon, ChevronsUpDownIcon, HashIcon, SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton,
  SidebarMenuSubItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import type { EstadoConexao } from "@/features/mensagens/useConversa";
import { cn } from "@/lib/utils";
import { corDe, siglaDe } from "@/shared/lib/formato";
import type { Tema } from "@/shared/lib/tema";
import { textos } from "@/shared/lib/textos";
import { useSalas } from "./useSalas";

interface Props {
  sala: string;
  nome: string;
  admin: boolean;
  vistas: Record<string, number>;
  estado: EstadoConexao;
  tema: Tema;
  aoEscolher: (sala: string) => void;
  aoBuscar: () => void;
  aoTema: (tema: Tema) => void;
  notificacoes: { ativas: boolean; negadas: boolean; alternar: () => void } | null;
  aoSair: () => void;
}

// Menu do usuário (Menu do Base UI) só carrega no 1º clique e já abre aberto.
const MenuUsuario = lazy(() => import("./MenuUsuario"));

function textoEstado(e: EstadoConexao): string {
  const c = textos.conexao;
  switch (e.tipo) {
    case "carregando": return c.carregando;
    case "ao-vivo": return c.aoVivo;
    case "reconectando": return c.reconectando(e.emSegundos);
    case "sem-acesso": return c.semAcesso;
  }
}

export function BarraLateral({ sala, nome, admin, vistas, estado, tema, aoEscolher, aoBuscar, aoTema, notificacoes, aoSair }: Props) {
  const { data, isPending } = useSalas();
  const { isMobile, setOpenMobile } = useSidebar();
  const lista = data ?? [];
  const todas = lista.some((s) => s.sala === sala) ? lista : [{ sala, total: 0, agentes: [] }, ...lista];
  // Canais de reunião aparecem aninhados na sala de origem (ativas sempre; encerradas, as 3 últimas).
  const salas = todas.filter((s) => !s.pai);
  const canaisDe = (pai: string) => {
    const filhos = todas.filter((s) => s.pai === pai).sort((a, b) => (b.reuniao?.id ?? 0) - (a.reuniao?.id ?? 0));
    const ativos = filhos.filter((c) => c.reuniao?.estado !== "encerrada");
    const encerrados = filhos.filter((c) => c.reuniao?.estado === "encerrada").slice(0, 3);
    return [...ativos, ...encerrados];
  };
  const vivo = estado.tipo === "ao-vivo";
  const [menuCarregado, setMenuCarregado] = useState(false);
  const cabecalho = (
    <>
                <Avatar className="rounded-lg after:rounded-lg">
        <AvatarFallback className="rounded-lg text-[11px] font-semibold text-white" style={{ background: corDe(nome) }}>
          {siglaDe(nome)}
        </AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-medium">{nome}</span>
        <span className="truncate text-xs text-muted-foreground">{admin ? "admin" : textos.sessao.humano}</span>
      </span>
      <ChevronsUpDownIcon className="ml-auto" />
    </>
  );

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
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={`${textos.paleta.abrir} (${textos.paleta.atalho})`} onClick={() => { if (isMobile) setOpenMobile(false); aoBuscar(); }}
                className="text-muted-foreground">
                <SearchIcon />
                <span>{textos.paleta.abrir}</span>
                <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px] group-data-[collapsible=icon]:hidden">{textos.paleta.atalho}</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{textos.salas.titulo}</SidebarGroupLabel>
          <SidebarMenu aria-label={textos.salas.lista}>
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
                      <span className="truncate text-xs text-muted-foreground">{s.agentes.filter(Boolean).join(", ") || textos.salas.vazia}</span>
                    </span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className={cn("group-data-[collapsible=icon]:hidden", naoLida && "bg-sidebar-primary text-sidebar-primary-foreground peer-hover/menu-button:text-sidebar-primary-foreground")}
                    aria-label={naoLida ? textos.salas.naoLidas(s.total) : textos.salas.total(s.total)}>
                    {s.total}
                  </SidebarMenuBadge>
                  {canaisDe(s.sala).length > 0 && (
                    <SidebarMenuSub aria-label={textos.reuniao.canais}>
                      {canaisDe(s.sala).map((c) => {
                        const viva = c.reuniao?.estado !== "encerrada";
                        return (
                          <SidebarMenuSubItem key={c.sala}>
                            <SidebarMenuSubButton isActive={c.sala === sala} aria-current={c.sala === sala ? "page" : undefined}
                              render={<button type="button" onClick={() => escolher(c.sala)} />}
                              className={cn("h-auto min-h-8 w-full py-1 text-left md:min-h-7", !viva && "text-muted-foreground")}>
                              <CalendarClockIcon className={cn(viva && "text-primary!")} />
                              <span className="min-w-0 flex-1 truncate">#{c.reuniao?.id} {c.reuniao?.titulo}</span>
                              {viva && <i aria-label={textos.reuniao.aoVivo} className="size-1.5 flex-none rounded-full bg-primary motion-safe:animate-pulse" />}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {menuCarregado ? (
              <Suspense fallback={<SidebarMenuButton size="lg">{cabecalho}</SidebarMenuButton>}>
                <MenuUsuario {...{ nome, admin, tema, aoTema, notificacoes, aoSair, isMobile }}>{cabecalho}</MenuUsuario>
              </Suspense>
            ) : (
              <SidebarMenuButton size="lg" aria-haspopup="menu" onClick={() => setMenuCarregado(true)}>{cabecalho}</SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
