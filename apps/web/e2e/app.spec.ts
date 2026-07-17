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

// A fixed AUD→USD rate seeded into the FX cache below (0.65 USD per 1 AUD), so
// the USD entry option is deterministically available with no live network.
const USD_RATE = 0.65;

test.beforeAll(async ({ request }) => {
  // Wipe emulator state so every run starts clean.
  await request.delete(
    `http://localhost:${FIRESTORE_PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
  );
  await request.delete(
    `http://localhost:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/accounts`,
  );
});

test("sign in, onboard, add expenses (AUD + USD), export/import CSV, switch language", async ({
  page,
}) => {
  // Seed today's FX rate into localStorage BEFORE any page script runs, so the
  // AUD|USD toggle appears without a live frankfurter call. The cache key
  // format must match src/lib/fx.ts (gd:fx:AUD-USD:<YYYY-MM-DD>, UTC day).
  await page.addInitScript((rate: number) => {
    const key = `gd:fx:AUD-USD:${new Date().toISOString().slice(0, 10)}`;
    window.localStorage.setItem(key, String(rate));
  }, USD_RATE);

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

  // Add an AUD expense in /gastos.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByLabel("0,00").fill("12,50");
  await page.getByLabel("Nota (opcional)").fill("Café de prueba");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The expense shows up with the correct amount.
  await expect(page.getByText("Café de prueba").first()).toBeVisible();
  await expect(page.getByText("$12,50").first()).toBeVisible();

  // Dashboard "Te queda" reflects it: 900,00 − 12,50 = 887,50. (Checked before
  // the USD expense below so this figure stays deterministic.)
  await page.getByRole("link", { name: "Resumen" }).click();
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$887,50").first()).toBeVisible();

  // Add a USD expense: switch the add row to USD, then enter 10,00 USD. At
  // rate 0.65 the stored canonical AUD is round(1000 / 0.65) = 1538 → $15,38.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByRole("tab", { name: "USD" }).click();
  await page.getByLabel("0,00").fill("10,00");
  await page.getByLabel("Nota (opcional)").fill("Almuerzo USD");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The row shows the canonical AUD as the bold figure and the entered USD
  // original beneath it ("≈ US$ 10,00").
  await expect(page.getByText("Almuerzo USD").first()).toBeVisible();
  await expect(page.getByText("US$ 10,00").first()).toBeVisible();

  // Data page: export the current period as CSV and import new expenses.
  await page.getByRole("link", { name: "Datos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datos" })).toBeVisible();

  // Export CSV — a download fires; its content includes both expenses with the
  // bi-currency columns (moneda/monto_original) and the USD original row.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar CSV" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csvText = Buffer.concat(chunks).toString("utf-8");
  expect(csvText).toContain(
    "fecha,categoria,nota,monto_aud,moneda,monto_original,creado_por",
  );
  expect(csvText).toContain("Café de prueba");
  expect(csvText).toContain("12.50");
  // The USD row: canonical AUD 15.38, entry currency USD, original USD 10.00.
  expect(csvText).toContain("Almuerzo USD");
  expect(csvText).toContain("15.38,USD,10.00");

  // Import a CSV with a USD row dated today (Sydney tz, so it lands in the
  // current period). monto_aud is the canonical AUD; monto_original the USD.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const importCsv = `fecha,categoria,nota,monto_aud,moneda,monto_original,creado_por\n${today},Súper,Import USD,13.00,USD,20.00,E2E Tester\n`;
  await page.getByLabel("Elegir archivo CSV").setInputFiles({
    name: "import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(importCsv, "utf-8"),
  });
  // Preview shows the parsed row with its USD original, then commit.
  await expect(page.getByText("Import USD")).toBeVisible();
  await expect(page.getByText("US$ 20,00")).toBeVisible();
  await page.getByRole("button", { name: /Importar 1 gasto/ }).click();
  await expect(page.getByText("Importado 1 gasto")).toBeVisible();

  // The imported USD expense shows up in Gastos with its USD original.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("Import USD").first()).toBeVisible();
  await expect(page.getByText("US$ 20,00").first()).toBeVisible();

  // Settings: switch the language to English and assert a label changes.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await page.getByRole("tab", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
