import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./app/router";
import { ProvedorSessao } from "./features/auth/sessao";
import "./index.css";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } } });
const raiz = document.getElementById("root");
if (!raiz) throw new Error("#root não encontrado");

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ProvedorSessao>
        <RouterProvider router={router} />
      </ProvedorSessao>
    </QueryClientProvider>
  </StrictMode>,
);
