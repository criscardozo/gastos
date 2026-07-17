// End-to-end happy path against the Firebase EMULATORS (see
// playwright.config.ts — Auth :9099 + Firestore :8080, project
// "demo-gastos-diarios", started externally). Sign-in uses the emulator-only
// window.__devSignIn hook wired in src/lib/firebase/client.ts.
//
// The default locale is Spanish (es-AR formatting), so assertions use the
// Spanish copy until the language is switched at the end.

import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __devSignIn?: (name?: string, email?: string) => Promise<unknown>;
  }
}

const PROJECT = "demo-gastos-diarios";
// Unique per run so reruns never collide even if the wipe below fails.
const EMAIL = `e2e-${Date.now()}@test.dev`;

test.beforeAll(async ({ request }) => {
  // Wipe emulator state so every run starts clean.
  await request.delete(
    `http://localhost:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
  );
  await request.delete(
    `http://localhost:9099/emulator/v1/projects/${PROJECT}/accounts`,
  );
});

test("sign in, onboard, add expense, check dashboard, switch language", async ({
  page,
}) => {
  await page.goto("/");

  // Sign in through the emulator-only hook (installed once Firebase
  // initializes client-side).
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((email) => window.__devSignIn!("E2E Tester", email), EMAIL);

  // Onboarding: create the household with the default budget ($900
  // fortnightly starting today).
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await expect(page.getByText("¿Cuánto por período?")).toBeVisible();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();

  // Dashboard renders once the first period materializes.
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // Add an expense in /gastos.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByLabel("0,00").fill("12,50");
  await page.getByLabel("Nota (opcional)").fill("Café de prueba");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The expense shows up with the correct amount.
  await expect(page.getByText("Café de prueba").first()).toBeVisible();
  await expect(page.getByText("$12,50").first()).toBeVisible();

  // Dashboard "Te queda" reflects it: 900,00 − 12,50 = 887,50.
  await page.getByRole("link", { name: "Resumen" }).click();
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$887,50").first()).toBeVisible();

  // Data page: export the current period as CSV and import a new expense.
  await page.getByRole("link", { name: "Datos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datos" })).toBeVisible();

  // Export CSV — a download fires and its content includes the expense.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar CSV" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csvText = Buffer.concat(chunks).toString("utf-8");
  expect(csvText).toContain("fecha,categoria,nota,monto_aud,creado_por");
  expect(csvText).toContain("Café de prueba");
  expect(csvText).toContain("12.50");

  // Import a CSV with one new expense dated today (Sydney tz, so it lands in
  // the current period) — "Súper" round-trips to the groceries category.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const importCsv = `fecha,categoria,nota,monto_aud,creado_por\n${today},Súper,Importado E2E,7.00,E2E Tester\n`;
  await page.getByLabel("Elegir archivo CSV").setInputFiles({
    name: "import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(importCsv, "utf-8"),
  });
  // Preview shows the parsed row, then commit the import.
  await expect(page.getByText("Importado E2E")).toBeVisible();
  await page.getByRole("button", { name: /Importar 1 gasto/ }).click();
  await expect(page.getByText("Importado 1 gasto")).toBeVisible();

  // The imported expense shows up in Gastos.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("Importado E2E").first()).toBeVisible();
  await expect(page.getByText("$7,00").first()).toBeVisible();

  // Settings: switch the language to English and assert a label changes.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await page.getByRole("tab", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
