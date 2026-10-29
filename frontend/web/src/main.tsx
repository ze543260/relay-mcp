import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./app/router";
import { ProvedorSessao } from "./features/auth/sessao";
import "./index.css";

// Depois de um deploy, os chunks antigos somem (nomes com hash) e uma aba aberta antes falha ao carregar
// uma tela lazy. Recarrega uma vez pra pegar a versão nova; se falhar de novo, deixa o erro aparecer.
window.addEventListener("vite:preloadError", (e) => {
  try {
    const ultima = Number(sessionStorage.getItem("relay-recarregou") ?? 0);
    if (Date.now() - ultima < 10_000) return;
    sessionStorage.setItem("relay-recarregou", String(Date.now()));
  } catch { /* sem storage: recarrega mesmo assim */ }
  e.preventDefault();
  window.location.reload();
});

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
