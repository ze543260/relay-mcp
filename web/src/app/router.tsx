import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { ler } from "@/shared/lib/armazenamento";
import { useToasterPedido } from "@/shared/lib/avisar";
import { lazy, Suspense, type JSX } from "react";
import { RotaSala } from "./rotas/RotaSala";

// Login (zod, RHF) e /config (tabela, diálogos) só carregam quando abertos.
const preguicoso = (carregar: () => Promise<{ default: () => JSX.Element }>) => {
  const C = lazy(carregar);
  return () => <Suspense fallback={<div className="h-dvh bg-background" />}><C /></Suspense>;
};
const RotaEntrar = preguicoso(() => import("./rotas/RotaEntrar").then((m) => ({ default: m.RotaEntrar })));
const RotaDs = preguicoso(() => import("./rotas/RotaDs").then((m) => ({ default: m.RotaDs })));
const RotaConfig = preguicoso(() => import("./rotas/RotaConfig").then((m) => ({ default: m.RotaConfig })));

const Toaster = lazy(() => import("@/components/ui/sonner"));

function Raiz() {
  const toaster = useToasterPedido();
  return (
    <>
      <Outlet />
      {toaster && <Suspense fallback={null}><Toaster position="top-center" /></Suspense>}
    </>
  );
}

const raiz = createRootRoute({ component: Raiz });

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
const rotaDs = createRoute({ getParentRoute: () => raiz, path: "/ds", component: RotaDs });

export const router = createRouter({
  routeTree: raiz.addChildren([inicio, rotaEntrar, rotaSala, rotaConfig, rotaDs]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
