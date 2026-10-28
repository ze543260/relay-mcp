import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Sobe o relay_server.py de verdade (banco temporário) servindo o build em web/dist.
const PORTA = 8799;
export const TOKEN_E2E = "e2e-token";
const banco = join(tmpdir(), `relay-e2e-${process.pid}.sqlite`);
// Chromium do sistema quando existir (sem baixar navegador); no CI usa o do Playwright.
const chromiumSistema = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const lancamento = chromiumSistema && !process.env.CI ? { executablePath: chromiumSistema } : {};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    trace: "retain-on-failure",
    launchOptions: lancamento,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: lancamento } },
    { name: "celular", use: { ...devices["Pixel 7"], launchOptions: lancamento } },
  ],
  webServer: {
    command: `python3 ../relay_server.py --porta ${PORTA}`,
    url: `http://127.0.0.1:${PORTA}/`,
    env: { RELAY_TOKEN: TOKEN_E2E, RELAY_DB: banco },
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
