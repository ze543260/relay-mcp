import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ler } from "@/shared/lib/armazenamento";
import { RotaEntrar } from "./rotas/RotaEntrar";
import { RotaSala } from "./rotas/RotaSala";

const raiz = createRootRoute({
  component: () => (
    <TooltipProvider delay={300}>
      <Outlet />
      <Toaster position="top-center" />
    </TooltipProvider>
  ),
});

const inicio = createRoute({
  getParentRoute: () => raiz,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/s/$sala", params: { sala: ler("relay-sala") ?? "geral" } });
  },
});

export const rotaEntrar = createRoute({
  getParentRoute: () => raiz,
  path: "/entrar",
  validateSearch: (s: Record<string, unknown>): { volta?: string } =>
    typeof s.volta === "string" ? { volta: s.volta } : {},
  component: RotaEntrar,
});

export const rotaSala = createRoute({
  getParentRoute: () => raiz,
  path: "/s/$sala",
  params: {
    parse: ({ sala }) => ({ sala: decodeURIComponent(sala).slice(0, 64) }),
    stringify: ({ sala }) => ({ sala: encodeURIComponent(sala) }),
  },
  component: RotaSala,
});

export const router = createRouter({
  routeTree: raiz.addChildren([inicio, rotaEntrar, rotaSala]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
