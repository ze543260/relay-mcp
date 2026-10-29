import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Em dev, a API do relay roda à parte (relay_server.py) e o Vite faz o proxy.
const API = process.env.RELAY_DEV_API ?? "http://127.0.0.1:8790";
const rotasApi = ["/mensagens", "/salas", "/agentes", "/sessao"];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: true,
    proxy: Object.fromEntries(rotasApi.map((rota) => [rota, { target: API, changeOrigin: true }])),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("katex") || id.includes("highlight.js") ? "markdown-pesado" : undefined),
      },
    },
  },
});
