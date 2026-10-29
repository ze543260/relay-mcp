import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { TOKEN_E2E } from "../playwright.config";

const auth = { Authorization: `Bearer ${TOKEN_E2E}` };

async function postar(request: APIRequestContext, sala: string, de: string, texto: string) {
  const r = await request.post("/mensagens", { headers: auth, data: { sala, de, texto } });
  expect(r.ok()).toBeTruthy();
}

async function entrar(page: Page, sala: string, nome = "jose") {
  await page.goto(`/s/${sala}`);
  await expect(page).toHaveURL(/\/entrar\?volta=/);
  await page.getByLabel("Seu nome").fill(nome);
  await page.getByLabel("Token").fill(TOKEN_E2E);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sala}$`));
  await expect(page.getByText("ao vivo").first()).toBeAttached();
}

const salaUnica = (t: { title: string }, projeto: string) =>
  `${projeto}-${t.title.replace(/\W+/g, "-").slice(0, 20)}-${Date.now() % 100000}`;

test("token errado mostra erro e não entra", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("Seu nome").fill("jose");
  await page.getByLabel("Token").fill("errado");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Token inválido.");
  await expect(page).toHaveURL(/\/entrar/);
});

test("envia mensagem e recebe outra ao vivo, com Markdown", async ({ page, request }, info) => {
  const sala = salaUnica(info, info.project.name);
  await postar(request, sala, "claude-julio", "## Contrato\n| a | b |\n|---|---|\n| 1 | 2 |");
  await entrar(page, sala);

  const conversa = page.getByRole("log", { name: "Mensagens" });
  await expect(conversa.getByRole("table")).toBeVisible();

  const caixa = page.getByRole("textbox", { name: "Mensagem" });
  await caixa.fill("oi do **e2e**");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(conversa.locator("strong", { hasText: "e2e" })).toBeVisible();
  await expect(caixa).toHaveValue("");

  await postar(request, sala, "gemma", "chegou ao vivo $x^2$");
  await expect(conversa.getByText("chegou ao vivo")).toBeVisible();
  await expect(conversa.locator(".katex")).toBeVisible();
});

test("XSS de outro agente não executa", async ({ page, request }, info) => {
  const sala = salaUnica(info, info.project.name);
  let alertou = false;
  page.on("dialog", (d) => { alertou = true; void d.dismiss(); });
  await postar(request, sala, "atacante", '<img src=x onerror="alert(1)"> [x](javascript:alert(1))');
  await entrar(page, sala);
  await page.getByRole("log").getByText("x", { exact: true }).click();
  expect(alertou).toBe(false);
  await expect(page.locator(".texto img")).toHaveCount(0);
});

test("F5 numa rota do app mantém a sala", async ({ page }, info) => {
  const sala = salaUnica(info, info.project.name);
  await entrar(page, sala);
  await page.reload();
  await expect(page.getByRole("heading", { name: `#${sala}` })).toBeVisible();
});

test("lateral de salas abre no celular e troca de sala", async ({ page, request }, info) => {
  test.skip(info.project.name !== "celular", "só no celular");
  const sala = salaUnica(info, info.project.name);
  await postar(request, `${sala}-b`, "julio", "na outra sala");
  await entrar(page, sala);
  await page.getByRole("button", { name: "Abrir salas" }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`#${sala}-b`) }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sala}-b$`));
  await expect(page.getByText("na outra sala")).toBeVisible();
});

test("sem violações graves de acessibilidade", async ({ page, request }, info) => {
  const sala = salaUnica(info, info.project.name);
  await postar(request, sala, "claude-julio", "mensagem **com** `código`");
  await entrar(page, sala);
  await expect(page.getByText("mensagem")).toBeVisible();
  const r = await new AxeBuilder({ page }).analyze();
  const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(graves.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
