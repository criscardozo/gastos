// End-to-end happy path against the Firebase EMULATORS (see
// playwright.config.ts — Auth + Firestore, project "demo-gastos-diarios",
// started externally). Sign-in uses the emulator-only window.__devSignIn hook
// wired in src/lib/firebase/client.ts.
//
// The emulator ports default to 9099 (auth) / 8080 (firestore) but can be
// overridden with NEXT_PUBLIC_AUTH_EMULATOR_PORT / _FIRESTORE_EMULATOR_PORT so
// the suite can run on alternate ports when the defaults are taken.
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

const AUTH_PORT = process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? "9099";
const FIRESTORE_PORT = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8080";

test.beforeAll(async ({ request }) => {
  // Wipe emulator state so every run starts clean.
  await request.delete(
    `http://localhost:${FIRESTORE_PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
  );
  await request.delete(
    `http://localhost:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/accounts`,
  );
});

test("sign in, onboard, add expenses, export/import CSV, switch language", async ({
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

  // A fresh expense is unverified: the bank's USD charge only arrives later.
  // (Scoped to the row control by role — "Sin verificar" is also a filter
  // option, and an <option> never counts as visible.)
  const unverifiedRow = page.getByRole("button", { name: /Sin verificar/ });
  await expect(unverifiedRow.first()).toBeVisible();

  // Verify it by typing what the bank charged, which flips the row to
  // "Verificado" showing the exact USD figure.
  await unverifiedRow.first().click();
  await page.getByLabel("USD que cobró el banco").fill("8,15");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page.getByText("US$ 8,15").first()).toBeVisible();
  await expect(unverifiedRow).toHaveCount(0);

  // The "Sin verificar" filter now hides it (and the "Verificados" one keeps
  // it), which is what the export gate will lean on.
  await page.getByLabel("verification").selectOption("unverified");
  await expect(page.getByText("Nada por acá")).toBeVisible();
  await page.getByLabel("verification").selectOption("verified");
  await expect(page.getByText("Café de prueba").first()).toBeVisible();
  await page.getByLabel("verification").selectOption("all");

  // Dashboard "Te queda" reflects it: 900,00 − 12,50 = 887,50.
  await page.getByRole("link", { name: "Inicio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$887,50").first()).toBeVisible();

  // Data page: export the current period as CSV and import new expenses.
  await page.getByRole("link", { name: "Datos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datos" })).toBeVisible();

  // Export CSV — a download fires and carries the expense we just added.
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

  // Import a CSV row dated today (Sydney tz, so it lands in the current
  // period). A legacy `moneda`/`monto_original` pair is included on purpose:
  // the importer must ignore those columns and take monto_aud as the amount.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const importCsv = `fecha,categoria,nota,monto_aud,moneda,monto_original,creado_por\n${today},Súper,Gasto importado,13.00,USD,20.00,E2E Tester\n`;
  await page.getByLabel("Elegir archivo CSV").setInputFiles({
    name: "import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(importCsv, "utf-8"),
  });
  // Preview shows the parsed row, then commit.
  await expect(page.getByText("Gasto importado")).toBeVisible();
  await expect(page.getByText("$13,00").first()).toBeVisible();
  await page.getByRole("button", { name: /Importar 1 gasto/ }).click();
  await expect(page.getByText("Importado 1 gasto")).toBeVisible();

  // The imported expense shows up in Gastos.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("Gasto importado").first()).toBeVisible();

  // Settings: switch the language to English and assert a label changes.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await page.getByRole("tab", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
