import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ler } from "@/shared/lib/armazenamento";
import { lazy, Suspense, type JSX } from "react";
import { RotaSala } from "./rotas/RotaSala";

// Login (zod, RHF) e /config (tabela, diálogos) só carregam quando abertos.
const preguicoso = (carregar: () => Promise<{ default: () => JSX.Element }>) => {
  const C = lazy(carregar);
  return () => <Suspense fallback={<div className="h-dvh bg-background" />}><C /></Suspense>;
};
const RotaEntrar = preguicoso(() => import("./rotas/RotaEntrar").then((m) => ({ default: m.RotaEntrar })));
const RotaConfig = preguicoso(() => import("./rotas/RotaConfig").then((m) => ({ default: m.RotaConfig })));

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

const rotaConfig = createRoute({ getParentRoute: () => raiz, path: "/config", component: RotaConfig });

export const router = createRouter({
  routeTree: raiz.addChildren([inicio, rotaEntrar, rotaSala, rotaConfig]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
