// End-to-end happy path against the Firebase EMULATORS (see
// playwright.config.ts — Auth + Firestore, project "demo-gastos-diarios",
// started externally). Sign-in uses the emulator-only window.__devSignIn hook
// wired in src/lib/firebase/client.ts.
//
// The emulator ports default to 9390 (auth) / 8390 (firestore) — this
// project's own block, because Firebase's defaults are all held by SSH
// forwards on this machine — and can be overridden with
// NEXT_PUBLIC_AUTH_EMULATOR_PORT / _FIRESTORE_EMULATOR_PORT.
//
// This comment said 9099/8080 for a while after the code below stopped: prose
// is a copy of those numbers that nothing checks and no refactor touches.
//
// The default locale is Spanish (es-AR formatting), so assertions use the
// Spanish copy until the language is switched at the end.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";

declare global {
  interface Window {
    __devSignIn?: (name?: string, email?: string) => Promise<unknown>;
  }
}

const PROJECT = "demo-gastos-diarios";
// Unique per run so reruns never collide even if the wipe below fails.
const EMAIL = `e2e-${Date.now()}@test.dev`;

const AUTH_PORT = process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? "9390";
const FIRESTORE_PORT = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8390";
/** Admin-side REST, for standing in as the Gmail ingestion (rules bypassed). */
const REST = `http://localhost:${FIRESTORE_PORT}/v1/projects/${PROJECT}/databases/(default)/documents`;

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
  // `exact`: getByLabel matches a SUBSTRING by default, and the verify button
  // in the grid is named after its expense — "…— Referencia, $100,00" contains
  // "0,00". Naming that button is what made this selector ambiguous, which is
  // the honest price of a control that says which row it belongs to.
  await page.getByLabel("0,00", { exact: true }).fill("12,50");
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

  // Tapping the row opens its detail, with the facts the list leaves out.
  await page.getByText("Café de prueba").first().click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Verificado")).toBeVisible();
  await expect(detail.getByText("US$ 8,15")).toBeVisible();
  await expect(detail.getByText("Cargado por")).toBeVisible();
  await expect(detail.getByText("E2E Tester")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  // The "Sin verificar" filter now hides it (and the "Verificados" one keeps
  // it), which is what the export gate will lean on.
  await page.getByLabel("verification").selectOption("unverified");
  await expect(page.getByText("Nada por acá")).toBeVisible();
  await page.getByLabel("verification").selectOption("verified");
  await expect(page.getByText("Café de prueba").first()).toBeVisible();
  await page.getByLabel("verification").selectOption("all");

  // A second expense, in a different category — the grid's category filter
  // below needs two to have anything to separate.
  await page.getByLabel("0,00", { exact: true }).fill("31,00");
  await page.getByLabel("Categoría: todas").selectOption("transport");
  await page.getByLabel("Nota (opcional)").fill("Nafta de prueba");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Nafta de prueba").first()).toBeVisible();

  // The same list can be looked at by calendar MONTH, which crosses period
  // boundaries on purpose — a fortnight is the budget, a month is a window.
  const thisMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  })
    .format(new Date())
    .slice(0, 7);
  await page.getByLabel("period").selectOption(`month:${thisMonth}`);
  // The pill names the month rather than printing its two boundary dates.
  const monthName = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    timeZone: "Australia/Sydney",
  }).format(new Date());
  await expect(
    page.getByText(`${monthName} ${thisMonth.slice(0, 4)}`).first(),
  ).toBeVisible();
  await expect(page.getByText("Café de prueba").first()).toBeVisible();

  // Dashboard "Te queda" reflects both: 900,00 − 12,50 − 31,00 = 856,50.
  await page.getByRole("link", { name: "Inicio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$856,50").first()).toBeVisible();

  // Data page: the grid shows the range, and the export carries the same rows.
  await page.getByRole("link", { name: "Datos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datos" })).toBeVisible();

  // The expense is ON SCREEN before any file exists — the point of the page.
  await expect(page.getByText("Café de prueba")).toBeVisible();
  // `.first()`: the grid prints it in the row and again in the total footer.
  await expect(page.getByText("US$ 8,15").first()).toBeVisible();

  // Sorting is by column heading, and it is the export's order too.
  await page.getByRole("button", { name: "Monto" }).click();
  await expect(
    page.getByRole("columnheader", { name: "Monto" }),
  ).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("button", { name: "Monto" }).click();
  await expect(
    page.getByRole("columnheader", { name: "Monto" }),
  ).toHaveAttribute("aria-sort", "descending");

  // Filtering happens in the column heading that owns it, and narrows what
  // leaves with you: another category empties the grid, and the TOTAL follows.
  await page.getByRole("button", { name: "Filtrar por categoría" }).click();
  await page.getByRole("checkbox", { name: "Súper" }).uncheck();
  await expect(page.getByText("Café de prueba")).toBeHidden();
  await expect(page.getByText("Nafta de prueba")).toBeVisible();
  // Twice: the row, and the footer total, which follows the filter.
  await expect(page.getByText("$31,00")).toHaveCount(2);
  // Ticking everything back on is the same as no filter at all.
  await page.getByRole("button", { name: "Todas" }).click();
  await expect(page.getByText("Café de prueba")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Datos" }).click();

  // Exporting is one button with a menu behind it, not four in a row — and the
  // consent for a range with unverified rows lives in there, with the action it
  // gates. The Nafta expense has no bank USD, so it is gated right now.
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.getByRole("menuitem", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "CSV" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("menuitem", { name: "CSV" })).toBeEnabled();

  // Export CSV — a download fires and carries the expense we just added.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "CSV" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csvText = Buffer.concat(chunks).toString("utf-8");
  expect(csvText).toContain(
    "fecha,categoria,nota,monto_aud,monto_usd,verificado,creado_por",
  );
  expect(csvText).toContain("Café de prueba");
  // The expense we verified above carries the bank's USD and reads as verified.
  expect(csvText).toContain("12.50,8.15,si,");

  // Import a CSV row dated today (Sydney tz, so it lands in the current
  // period). A legacy `moneda`/`monto_original` pair is included on purpose:
  // the importer must ignore those columns and take monto_aud as the amount.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const importCsv = `fecha,categoria,nota,monto_aud,moneda,monto_original,creado_por\n${today},Súper,Gasto importado,13.00,USD,20.00,E2E Tester\n`;
  // Importing lives in Ajustes now: it is the one control on either screen
  // that writes rows, and it had been sitting next to four read-only buttons.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
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
  await page.getByRole("tab", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("a bank charge is matched to the expense it paid for", async ({
  page,
  request,
}) => {
  // A second household, so this test is independent of the one above.
  const email = `e2e-bank-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Bank Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  for (const [amount, note] of [
    ["100,00", "Referencia"],
    ["63,90", "Coles"],
    ["12,00", "Otra cosa"],
  ]) {
    // The save clears the add row asynchronously; typing before it does would
    // lose the amount.
    await expect(page.getByLabel("0,00", { exact: true })).toHaveValue("");
    await page.getByLabel("0,00", { exact: true }).fill(amount);
    await page.getByLabel("Nota (opcional)").fill(note);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(note).first()).toBeVisible();
  }

  // Teach the app the bank's rate: 100,00 AUD was billed as US$ 65,00 → 0.65.
  await page
    .locator("div")
    .filter({ hasText: /^Referencia/ })
    .first()
    .getByRole("button", { name: /Sin verificar/ })
    .click();
  await page.getByLabel("USD que cobró el banco").fill("65,00");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page.getByText("US$ 65,00").first()).toBeVisible();

  // Now do the ingestion's job by hand: file a charge of US$ 41,54, which at
  // the learned rate can only be the 63,90 expense.
  const households = await request.get(`${REST}/households`, {
    headers: { Authorization: "Bearer owner" },
  });
  // Pick THIS test's household by name — the other test in this file has one
  // too, and the REST listing's order is not ours to rely on.
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find(
    (d) => d.fields.name.stringValue === "Hogar de Bank",
  );
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;
  const created = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-abc123`,
    {
      headers: { Authorization: "Bearer owner" },
      data: {
        fields: {
          usdCents: { integerValue: "4154" },
          date: {
            stringValue: new Intl.DateTimeFormat("en-CA", {
              timeZone: "Australia/Sydney",
            }).format(new Date()),
          },
          merchant: { stringValue: "COLES 0831" },
          cardLast4: { stringValue: "1234" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(created.ok()).toBe(true);

  // The panel shows up on its own (live listener) with the learned rate.
  await expect(page.getByText("1 cargo del banco sin asignar")).toBeVisible();
  await expect(page.getByText(/Tasa del banco aprendida/)).toBeVisible();
  // No "Revisar" any more: the panel opens itself when something is waiting,
  // which is what pressing that used to be for. Waiting on a row instead of a
  // toggle also says what the test actually needs.
  await expect(page.getByRole("button", { name: /Descartar/ }).first())
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("US$ 41,54")).toBeVisible();

  // Discarding is recoverable for 48 hours. Worth an end-to-end pass because
  // it is the one flow that depends on BOTH the narrow update rule and the
  // estimated server timestamp: without the estimate the charge would stay
  // looking pending until the ack, and the press would seem to do nothing.
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByText("Sin cargos pendientes")).toBeVisible();
  await page.getByRole("button", { name: "1 descartado" }).click();
  await expect(page.getByText(/Se pueden recuperar durante 48 horas/)).toBeVisible();

  // And back: the charge returns to the pending list, still matchable. The
  // panel is still expanded from before — it does not collapse just because it
  // briefly had nothing pending — so there is no Revisar to press again.
  await page.getByRole("button", { name: /^Restaurar US\$ 41,54$/ }).click();
  await expect(page.getByText("1 cargo del banco sin asignar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ocultar" })).toBeVisible();
  await expect(page.getByText("US$ 41,54")).toBeVisible();

  // It suggested the Coles expense rather than the 12,00 one.
  const picker = page.getByLabel("Gasto a verificar");
  const suggested = await picker.inputValue();
  expect(suggested).not.toBe("");
  await expect(picker.locator(`option[value="${suggested}"]`)).toHaveText(
    /Coles/,
  );

  await page.getByRole("button", { name: "Asignar" }).click();

  // The expense is verified and the charge is gone from Firestore for good.
  await expect(page.getByText("1 cargo del banco sin asignar")).toHaveCount(0);
  await expect(page.getByText("US$ 41,54").first()).toBeVisible();
  // Poll rather than read once: the UI reflects the local write immediately,
  // so a single read here can beat the batch's server ack.
  await expect
    .poll(async () => {
      const charges = await request.get(
        `${REST}/households/${householdId}/bankCharges`,
        { headers: { Authorization: "Bearer owner" } },
      );
      return "documents" in (await charges.json());
    })
    .toBe(false);
});

/** Household-timezone today, shifted by `days`. */
function sydneyDate(days = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(now);
}

const admin = { Authorization: "Bearer owner" };

/**
 * The repo's real rules, and a way to put them back.
 *
 * Two tests below load restrictive rules on purpose, to make the server refuse
 * something. Restoring them at the END OF THE TEST BODY is not enough: when the
 * assertion in between fails, the restore never runs and every later test dies
 * with PERMISSION_DENIED, blaming the wrong code. Hence afterEach.
 */
const REAL_RULES = readFileSync(
  // Playwright's cwd is apps/web.
  join(process.cwd(), "..", "..", "firebase", "firestore.rules"),
  "utf8",
);

async function loadRules(
  request: APIRequestContext,
  content: string,
): Promise<void> {
  const res = await request.put(
    `http://localhost:${FIRESTORE_PORT}/emulator/v1/projects/${PROJECT}:securityRules`,
    { headers: admin, data: { rules: { files: [{ name: "firestore.rules", content }] } } },
  );
  expect(res.ok()).toBe(true);
}

test.afterEach(async ({ request }) => {
  await loadRules(request, REAL_RULES);
});

test("starting a period asks, and carries the leftover", async ({
  page,
  request,
}) => {
  // Its own household, independent of the other tests in this file.
  const email = `e2e-period-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Period Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // Find the household onboarding just created — by name, since the other
  // tests in this file have theirs too.
  const households = await request.get(`${REST}/households`, { headers: admin });
  const mine = ((await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[]).find((d) => d.fields.name.stringValue === "Hogar de Period");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // Rewrite history so a period ENDED yesterday, leaving 200,00 of its 900,00
  // unspent, and today opens a fresh one nobody has confirmed.
  const yesterday = sydneyDate(-1);
  const previousStart = sydneyDate(-14);
  const today = sydneyDate(0);
  const periods = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  const existing = ((await periods.json()).documents ?? []) as { name: string }[];
  for (const doc of existing) {
    const id = doc.name.split("/").pop() as string;
    await request.delete(
      `${REST}/households/${householdId}/periodBudgets/${id}`,
      { headers: admin },
    );
  }
  // PATCH, not POST-with-documentId: deleting the periods above leaves the app
  // free to re-materialize today's before this runs, and a create would then
  // collide with it (ALREADY_EXISTS). A patch just overwrites whatever is
  // there, which is the state this test wants either way.
  const write = async (id: string, fields: Record<string, unknown>) => {
    const res = await request.patch(
      `${REST}/households/${householdId}/periodBudgets/${id}`,
      { headers: admin, data: { fields } },
    );
    expect(res.ok()).toBe(true);
  };
  await write(previousStart, {
    startDate: { stringValue: previousStart },
    endDate: { stringValue: yesterday },
    period: { stringValue: "fortnightly" },
    amountCents: { integerValue: "90000" },
    source: { stringValue: "custom" },
    createdAt: { timestampValue: new Date().toISOString() },
    updatedAt: { timestampValue: new Date().toISOString() },
  });
  await write(today, {
    startDate: { stringValue: today },
    endDate: { stringValue: sydneyDate(13) },
    period: { stringValue: "fortnightly" },
    amountCents: { integerValue: "90000" },
    source: { stringValue: "default" },
    createdAt: { timestampValue: new Date().toISOString() },
    updatedAt: { timestampValue: new Date().toISOString() },
  });
  // 700,00 spent in the period that ended → 200,00 left over.
  const expense = await request.post(
    `${REST}/households/${householdId}/expenses`,
    {
      headers: admin,
      data: {
        fields: {
          amountCents: { integerValue: "70000" },
          categoryId: { stringValue: "groceries" },
          note: { stringValue: "Del período anterior" },
          date: { stringValue: yesterday },
          createdBy: { stringValue: "seed" },
          verified: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(expense.ok()).toBe(true);

  // The app is watching this collection the whole time, so between the deletes
  // above and the writes it is free to materialize a period of its OWN — and a
  // stray period sitting between the two this test wrote is not harmless: the
  // leftover is read from the period BEFORE the current one, and a stray one
  // has no expenses in it, so the figure silently comes back 0. That is what
  // made this test fail on CI and never locally; the runner is slow enough to
  // lose the race. Deleting anything we did not write closes it, and by now
  // the two periods it wants exist, so there is nothing left for the app to
  // create.
  const wanted = new Set([previousStart, today]);
  const after = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  for (const doc of (((await after.json()).documents ?? []) as { name: string }[])) {
    const id = doc.name.split("/").pop() as string;
    if (!wanted.has(id)) {
      await request.delete(
        `${REST}/households/${householdId}/periodBudgets/${id}`,
        { headers: admin },
      );
    }
  }

  // Stand in the shoes of someone who answered LAST period and is opening the
  // app on the first day of this one. (Clearing storage instead would look
  // like a brand-new device, which by design is marked as seen rather than
  // asked about a period that started before it ever ran.)
  await page.evaluate(
    ([id, start]) => localStorage.setItem(`gd:newPeriodAck:${id}`, start),
    [householdId, previousStart],
  );
  await page.reload();

  // The screen shows up by itself and cannot be clicked away.
  await expect(page.getByText("Repetir presupuesto · $900")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.click(5, 5);
  await expect(page.getByText("Repetir presupuesto · $900")).toBeVisible();
  await expect(page.getByText("Ahora no")).toHaveCount(0);

  // The leftover is a server-side sum() over the PREVIOUS period, so it lands
  // after the screen does. Wait for the row to show the figure it should have
  // found — 900 budgeted less 700 spent — rather than for the row to merely
  // exist. The row renders for ANY non-zero leftover, so clicking as soon as it
  // appears will happily tick a wrong number and then fail twenty seconds later
  // on the total, which is what CI kept doing while every local run passed.
  const leftoverRow = page.getByRole("button", { name: /Incluir lo que sobró/ });
  await expect(leftoverRow).toContainText("$200,00");

  // And assert the period state directly, so a stray period fails HERE with a
  // count rather than downstream as a missing figure. Verified by injecting one:
  // this reports expect(3).toBe(2) in a second, where the old test spent
  // twenty-five and blamed the total.
  const periodsNow = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  expect(((await periodsNow.json()).documents ?? []).length).toBe(2);

  // Ticking the leftover moves the figure and the button.
  await leftoverRow.click();
  await expect(page.getByText("$1.100,00")).toBeVisible();
  await expect(page.getByText("Repetir presupuesto · $1.100")).toBeVisible();
  await expect(page.getByText("$900 de siempre + $200 del período anterior")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("button", { name: /Repetir presupuesto/ }).click();
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$1.100,00").first()).toBeVisible();

  // It wrote both figures — the amount and what of it was carried in — and
  // stamped the answer on the DOCUMENT, so no other device asks again.
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets/${today}`,
        { headers: admin },
      );
      const fields = (await res.json()).fields as Record<
        string,
        { integerValue?: string; stringValue?: string; timestampValue?: string }
      >;
      return [
        fields.amountCents?.integerValue,
        fields.rolloverCents?.integerValue,
        fields.source?.stringValue,
        fields.confirmedAt?.timestampValue === undefined ? "unconfirmed" : "confirmed",
      ].join("/");
    })
    .toBe("110000/20000/custom/confirmed");

  // And a device that never answered does not ask about it either: same
  // household, same period, storage wiped so this looks like another phone.
  await page.evaluate(
    ([id, start]) => localStorage.setItem(`gd:newPeriodAck:${id}`, start),
    [householdId, previousStart],
  );
  await page.reload();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Repetir presupuesto/)).toHaveCount(0);

  // Ajustes can bring the screen back, and that one CAN be dismissed.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.getByRole("button", { name: /Iniciar la quincena/ }).click();
  await expect(page.getByText("Ahora no")).toBeVisible();
  await page.getByText("Ahora no").click();
  await expect(page.getByText(/Repetir presupuesto/)).toHaveCount(0);

});


/**
 * Stretching the period that just ended, which is how the week's START day is
 * moved without throwing away what is still in it.
 *
 * Cristian's real case: a week ended with money left, and he wanted those days
 * to run through Sunday so the next period would start on a Monday. What has to
 * hold end to end is that the stretch buys DAYS and not money — the budget is
 * untouched, the expenses already logged re-bucket into the longer range, and
 * nothing new is materialized until the stretched period actually ends.
 */
test("a period can be stretched so the next one starts later", async ({
  page,
  request,
}) => {
  const email = `e2e-stretch-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Stretch Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const mine = ((await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[]).find((d) => d.fields.name.stringValue === "Hogar de Stretch");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // Same rewrite as the test above: a period ended yesterday having spent
  // 700,00 of its 900,00, and today opened a fresh one nobody has answered.
  const previousStart = sydneyDate(-14);
  const yesterday = sydneyDate(-1);
  const today = sydneyDate(0);
  const stretchedEnd = sydneyDate(2);
  const clear = async () => {
    const res = await request.get(
      `${REST}/households/${householdId}/periodBudgets`,
      { headers: admin },
    );
    for (const doc of (((await res.json()).documents ?? []) as { name: string }[])) {
      const id = doc.name.split("/").pop() as string;
      if (id !== previousStart && id !== today) {
        await request.delete(
          `${REST}/households/${householdId}/periodBudgets/${id}`,
          { headers: admin },
        );
      }
    }
  };
  const write = async (id: string, fields: Record<string, unknown>) => {
    const res = await request.patch(
      `${REST}/households/${householdId}/periodBudgets/${id}`,
      { headers: admin, data: { fields } },
    );
    expect(res.ok()).toBe(true);
  };
  await clear();
  // CONFIRMED, because that is the real shape: the period being stretched is
  // one somebody answered a fortnight ago. It also proves the rules let a
  // settled period's end date move — what they refuse is deleting it.
  await write(previousStart, {
    startDate: { stringValue: previousStart },
    endDate: { stringValue: yesterday },
    period: { stringValue: "fortnightly" },
    amountCents: { integerValue: "90000" },
    source: { stringValue: "custom" },
    confirmedAt: { timestampValue: new Date().toISOString() },
    createdAt: { timestampValue: new Date().toISOString() },
    updatedAt: { timestampValue: new Date().toISOString() },
  });
  await write(today, {
    startDate: { stringValue: today },
    endDate: { stringValue: sydneyDate(13) },
    period: { stringValue: "fortnightly" },
    amountCents: { integerValue: "90000" },
    source: { stringValue: "default" },
    createdAt: { timestampValue: new Date().toISOString() },
    updatedAt: { timestampValue: new Date().toISOString() },
  });
  const expense = await request.post(
    `${REST}/households/${householdId}/expenses`,
    {
      headers: admin,
      data: {
        fields: {
          amountCents: { integerValue: "70000" },
          categoryId: { stringValue: "groceries" },
          note: { stringValue: "Antes de estirar" },
          date: { stringValue: yesterday },
          createdBy: { stringValue: "seed" },
          verified: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(expense.ok()).toBe(true);
  await clear();

  await page.evaluate(
    ([id, start]) => localStorage.setItem(`gd:newPeriodAck:${id}`, start),
    [householdId, previousStart],
  );
  await page.reload();
  await expect(page.getByText("Repetir presupuesto · $900")).toBeVisible({
    timeout: 20_000,
  });

  // The third answer, and what it says out loud: the money it continues on.
  await page.getByRole("button", { name: "Estirar el presupuesto anterior" }).click();
  await expect(page.getByText(/Seguís con \$900/)).toBeVisible();

  // Nothing is offered before the date is a real one: the box opens on the
  // earliest date that is a stretch at all.
  await expect(page.getByRole("button", { name: /Estirar el período/ })).toBeEnabled();
  await page.getByLabel("Hasta cuándo").fill(stretchedEnd);
  // The consequence is stated as the day the NEXT period starts, because that
  // is the whole point of doing this.
  await expect(page.getByText(/días más · el próximo período arranca el/)).toBeVisible();

  await page.getByRole("button", { name: /Estirar el período/ }).click();

  // Back on the dashboard, still inside the stretched period — and the money
  // did not move: 900 budgeted, 700 spent, 200 left.
  await expect(page.getByText("Te queda")).toBeVisible();
  await expect(page.getByText("$200,00").first()).toBeVisible();

  // One period, ending on the chosen day. The one that was starting today is
  // gone, and NOTHING new was materialized: the chain resumes the day after
  // the stretched period ends, which has not happened yet.
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets`,
        { headers: admin },
      );
      const documents = ((await res.json()).documents ?? []) as {
        name: string;
        fields: {
          endDate: { stringValue: string };
          amountCents: { integerValue: string };
        };
      }[];
      return documents
        .map(
          (d) =>
            `${d.name.split("/").pop()}..${d.fields.endDate.stringValue}` +
            `@${d.fields.amountCents.integerValue}`,
        )
        .sort()
        .join(" | ");
    })
    .toBe(`${previousStart}..${stretchedEnd}@90000`);
});


test("an expense saved offline does not freeze the form", async ({
  page,
  context,
}) => {
  const email = `e2e-offline-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Offline Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByLabel("0,00", { exact: true })).toHaveValue("");

  // Cut the network the way a phone does. Firestore queues the write and
  // serves it straight back from the local cache — but its promise stays
  // pending until a server acknowledges, so anything awaiting it is stuck.
  await context.setOffline(true);
  await page.getByLabel("0,00", { exact: true }).fill("12,50");
  await page.getByLabel("Nota (opcional)").fill("Sin señal");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The expense is on screen, and the form is ready for the next one rather
  // than holding the amount hostage until the network comes back (which is how
  // a second tap turns into a duplicate expense).
  await expect(page.getByText("Sin señal").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel("0,00", { exact: true })).toHaveValue("");

  // And no error dialog: Firestore queues a write made without signal and sends
  // it later, so there is nothing to report. This is the other half of "a write
  // the server refuses says so" — if offline alerted, that alert would be noise
  // on every trip through a tunnel.
  await expect(page.getByText("No se pudo guardar")).toHaveCount(0);

  // And it really does reach the server once there is one.
  await context.setOffline(false);
  await expect(page.getByText("Sin señal").first()).toBeVisible();
});

test("a leftover that could not be read is not materialized as zero", async ({
  page,
  request,
}) => {
  const email = `e2e-carry-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Carry Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const mine = ((await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[]).find((d) => d.fields.name.stringValue === "Hogar de Carry");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // Rollover on, and one period that ENDED yesterday with something left in it.
  // No period for today: the app has to materialize it, which is when it reads
  // the leftover.
  const rollover = await request.patch(
    `${REST}/households/${householdId}?updateMask.fieldPaths=defaultBudget`,
    {
      headers: admin,
      data: {
        fields: {
          defaultBudget: {
            mapValue: {
              fields: {
                amountCents: { integerValue: "90000" },
                period: { stringValue: "fortnightly" },
                anchorDate: { stringValue: sydneyDate(-14) },
                rollover: { booleanValue: true },
              },
            },
          },
        },
      },
    },
  );
  expect(rollover.ok()).toBe(true);

  const yesterday = sydneyDate(-1);
  const previousStart = sydneyDate(-14);
  const existing = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  for (const doc of (((await existing.json()).documents ?? []) as { name: string }[])) {
    const id = doc.name.split("/").pop() as string;
    await request.delete(
      `${REST}/households/${householdId}/periodBudgets/${id}`,
      { headers: admin },
    );
  }
  const seeded = await request.patch(
    `${REST}/households/${householdId}/periodBudgets/${previousStart}`,
    {
      headers: admin,
      data: {
        fields: {
          startDate: { stringValue: previousStart },
          endDate: { stringValue: yesterday },
          period: { stringValue: "fortnightly" },
          amountCents: { integerValue: "90000" },
          source: { stringValue: "custom" },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(seeded.ok()).toBe(true);

  // Break ONLY the aggregation. Everything else — the listeners, the writes —
  // keeps working, which is what makes this the narrow case it is: the server
  // answered the period listener (so materialization is allowed to run) and
  // then the one read that says how much was left fails.
  // Break the one read that says how much was left: the leftover comes from a
  // SUM aggregation over expenses. Everything else keeps working, which is what
  // makes this the narrow case it is — the server answered the period listener,
  // so materialization is allowed to run, and then this fails.
  const denyExpenseReads = REAL_RULES.replace(
    `      match /expenses/{expenseId} {
        allow read: if isMember(householdId);`,
    `      match /expenses/{expenseId} {
        allow read: if false;`,
  );
  expect(denyExpenseReads).not.toBe(REAL_RULES);
  await loadRules(request, denyExpenseReads);

  // Wait until the new rules actually bite before clearing anything. Loading
  // them is not instant, and the app materializes today's period the moment it
  // can read the leftover — so without this the test races the emulator and
  // passes or fails on timing. The month total is the probe: it is another
  // aggregation over expenses, so "no disponible" means reads are refused now.
  await page.goto("/");
  await expect(page.getByText("No disponible por ahora")).toBeVisible({
    timeout: 20_000,
  });

  // Park the browser off the app: while a client is running it will happily
  // materialize today's period itself, and then there is nothing left for the
  // reload to attempt.
  await page.goto("about:blank");
  const stale = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  for (const doc of (((await stale.json()).documents ?? []) as { name: string }[])) {
    const id = doc.name.split("/").pop() as string;
    if (id === previousStart) continue;
    await request.delete(
      `${REST}/households/${householdId}/periodBudgets/${id}`,
      { headers: admin },
    );
  }

  await page.goto("/");
  // It says so, instead of writing a period whose leftover is a made-up zero.
  await expect(page.getByRole("dialog")).toContainText("No se pudo guardar", {
    timeout: 25_000,
  });

  // And nothing was written: only the period this test seeded exists.
  const periods = await request.get(
    `${REST}/households/${householdId}/periodBudgets`,
    { headers: admin },
  );
  const ids = (((await periods.json()).documents ?? []) as { name: string }[]).map(
    (d) => d.name.split("/").pop(),
  );
  expect(ids).toEqual([previousStart]);
});

test("a write the server refuses says so", async ({ page, request }) => {
  const email = `e2e-refused-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Refused Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByLabel("0,00", { exact: true })).toHaveValue("");

  // Make the server refuse. Loading rules into the emulator is how a real
  // rejection is produced without touching the repo's own rules file. The
  // matching "offline must stay quiet" case lives in the offline test above,
  // which is where the offline machinery already is.
  const deny = `
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} { allow read: if true; allow write: if false; }
      }
    }`;
  await loadRules(request, deny);

  await page.getByLabel("0,00", { exact: true }).fill("33,00");
  await page.getByLabel("Nota (opcional)").fill("Rechazado");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The whole point: the app says the change did not stick, instead of leaving
  // the local cache showing it as saved for ever.
  await expect(page.getByRole("dialog")).toContainText("No se pudo guardar");
  await page.getByRole("button", { name: "Entendido" }).click();
  await expect(page.getByText("No se pudo guardar")).toHaveCount(0);
});

test("renaming a category keeps it out of the budget", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-rename-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("Rename Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Ajustes" }).click();

  // Take "Salud" out of the budget.
  const toggle = page.getByRole("switch", { name: /Salud/ });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // Then rename it. This is what used to quietly put it back in.
  await page.getByRole("button", { name: /Renombrar Salud/ }).click();
  const field = page.getByLabel("Nombre de la categoría");
  await field.fill("Farmacia");
  await field.press("Enter");
  await expect(page.getByText("Farmacia")).toBeVisible();

  // The stored category must still carry countsToBudget: false.
  await expect
    .poll(async () => {
      const households = await request.get(`${REST}/households`, {
        headers: admin,
      });
      const doc = ((await households.json()).documents as {
        fields: {
          name: { stringValue: string };
          categories: { mapValue: { fields: Record<string, {
            mapValue: { fields: Record<string, {
              stringValue?: string; booleanValue?: boolean }> } }> } };
        };
      }[]).find((d) => d.fields.name.stringValue === "Hogar de Rename");
      if (doc === undefined) return "household not found";
      const health = doc.fields.categories.mapValue.fields.health.mapValue.fields;
      return JSON.stringify({
        name: health.name?.stringValue,
        key: health.key?.stringValue ?? null,
        counts: health.countsToBudget?.booleanValue ?? "absent",
      });
    })
    .toBe(JSON.stringify({ name: "Farmacia", key: null, counts: false }));

  // And the switch still reads as off after the rename.
  await expect(
    page.getByRole("switch", { name: /Farmacia/ }),
  ).toHaveAttribute("aria-checked", "false");
});

/** Household-timezone date, shifted by `days` — the stats seed needs a spread. */
function statsDate(days = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(now);
}

test("the statistics page adds up what the ledger says", async ({ page, request }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-stats-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("Stats Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const mine = ((await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[]).find((d) => d.fields.name.stringValue === "Hogar de Stats");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // A fortnight of realistic spending, seeded straight in so the charts have
  // something to draw: a few categories, a couple of big ones, quiet days.
  const seed: [number, string, string, number][] = [
    [6390, "groceries", "Coles", 0],
    [1250, "coffee", "Café", 0],
    [820, "transport", "Opal", -1],
    [14500, "eatingOut", "Cena", -2],
    [3200, "groceries", "Woolworths", -3],
    [980, "coffee", "Café", -3],
    [4500, "home", "Ferretería", -5],
    [2100, "health", "Farmacia", -6],
    [760, "transport", "Opal", -6],
    [23000, "groceries", "Compra grande", -8],
    [1500, "entertainment", "Cine", -9],
    [890, "coffee", "Café", -10],
  ];
  for (const [amountCents, categoryId, note, offset] of seed) {
    const verified = amountCents > 2000;
    const res = await request.post(
      `${REST}/households/${householdId}/expenses`,
      {
        headers: admin,
        data: {
          fields: {
            amountCents: { integerValue: String(amountCents) },
            categoryId: { stringValue: categoryId },
            note: { stringValue: note },
            date: { stringValue: statsDate(offset) },
            createdBy: { stringValue: "seed" },
            verified: { booleanValue: verified },
            ...(verified
              ? {
                  usdCents: {
                    integerValue: String(Math.round(amountCents * 0.7123)),
                  },
                }
              : {}),
            createdAt: { timestampValue: new Date().toISOString() },
            updatedAt: { timestampValue: new Date().toISOString() },
          },
        },
      },
    );
    expect(res.ok()).toBe(true);
  }

  await page.getByRole("link", { name: "Estadísticas" }).click();
  await expect(page.getByRole("heading", { name: "Estadísticas" })).toBeVisible();

  // The 90-day range covers everything seeded above.
  await page.getByRole("tab", { name: "90 días" }).click();
  await expect(page.getByText("Total gastado")).toBeVisible();
  await expect(page.getByText("Por categoría")).toBeVisible();
  await expect(page.getByText("Confirmado por el banco")).toBeVisible();
  await expect(page.getByText(/Tasa aprendida: 0,712/)).toBeVisible();

  // The current period shows the pace chart, which the other ranges cannot.
  await page.getByRole("tab", { name: "Período actual" }).click();
  await expect(page.getByText("Ritmo contra el presupuesto")).toBeVisible();

});

/**
 * Servicios + Tarjetas: two registers that keep their own books.
 *
 * The thing worth pinning down is the BUCKETING. A card charge stores no
 * statement id — it belongs to whichever statement's window contains its date —
 * so closing a statement must leave the old charges exactly where they were,
 * and the new one must start empty. That is the property a stored id would
 * quietly break, and it is what this test walks through.
 */
test("services and card statements keep their own books", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-cards-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("Cards Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  /* ── Servicios ───────────────────────────────────────────────────────── */

  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await expect(page.getByText("Todavía no hay servicios")).toBeVisible();

  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Nombre").fill("Netflix");
  // Both currencies are typed by hand: the app converts neither into the other.
  await page.getByLabel("AUD").fill("22,99");
  await page.getByLabel("USD").fill("14,99");
  await page.getByLabel("Día de vencimiento").fill("7");
  await page.getByRole("tab", { name: "Crédito" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText("Netflix")).toBeVisible();
  // Twice on screen on purpose: once in the row, once in this month's total
  // (a monthly service falls due every month, so it is all of it).
  await expect(page.getByText("$22,99").first()).toBeVisible();
  await expect(page.getByText("US$ 14,99").first()).toBeVisible();

  // The two figures the screen leads with. Nothing has been charged yet, so
  // one is empty and the other is the whole month.
  await expect(page.getByText("A pagar este mes")).toBeVisible();
  await expect(page.getByText("Cobrado este mes")).toBeVisible();
  await expect(page.getByText("0 de 1 servicios del mes")).toBeVisible();
  await expect(page.getByText("Todavía no se cobró")).toBeVisible();

  // A yearly service needs a month to anchor its cycle; a monthly one must not
  // have the field at all, because the rules reject an anchor on it.
  await page.getByText("Netflix").click();
  await expect(page.getByLabel("Mes")).toBeHidden();
  await page.getByLabel("Frecuencia").selectOption("yearly");
  await expect(page.getByLabel("Mes")).toBeVisible();
  await page.getByLabel("Frecuencia").selectOption("monthly");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/Mensual/).first()).toBeVisible();

  /* ── Tarjetas ────────────────────────────────────────────────────────── */

  await page.getByRole("link", { name: "Tarjetas", exact: true }).click();
  await expect(page.getByText("Todavía no hay resúmenes")).toBeVisible();

  // Cristian's real cycle: closes on the 27th, payable by the 7th of the month
  // after. Derived from TODAY rather than written down — a statement can only
  // ever be opened into the future, so hard-coded dates make this test start
  // failing the day the month rolls over rather than the day the code breaks.
  const sydney = (offsetMonths: number, day: number): string => {
    const now = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
    }).format(new Date());
    const [y, m] = [Number(now.slice(0, 4)), Number(now.slice(5, 7))];
    const d = new Date(Date.UTC(y, m - 1 + offsetMonths, day));
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  };
  // Next month's 27th, so today is always inside the window it opens.
  const closing1 = sydney(1, 27);
  const due1 = sydney(2, 7);
  const closing2 = sydney(2, 27);
  const due2 = sydney(3, 7);

  await page.getByRole("button", { name: "Abrir el primer resumen" }).click();
  await page.getByLabel("Cierre").fill(closing1);
  await page.getByLabel("Vencimiento").fill(due1);
  await page.getByRole("button", { name: "Abrir resumen" }).click();
  await expect(page.getByText("Resumen actual")).toBeVisible();

  // A charge lands in the statement whose window holds its date. Left on the
  // default, which the screen has already clamped into that window.
  await page.getByRole("button", { name: "Agregar gasto" }).click();
  await page.getByLabel("Monto (USD)").fill("19,99");
  await page.getByLabel("Detalle").fill("Steam");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Steam")).toBeVisible();
  await expect(page.getByText("US$ 19,99").first()).toBeVisible();

  // Close it and open the next: both dates are proposed a month on, keeping
  // their day of the month, and the window starts the day after — so no charge
  // can fall between two statements.
  await page.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  await expect(page.getByLabel("Cierre")).toHaveValue(closing2);
  await expect(page.getByLabel("Vencimiento")).toHaveValue(due2);
  // Carrying the unchecked charges over is offered and ON by default; untick it
  // here, because what this test pins down is the property underneath — a
  // charge sits in the window its DATE falls in, and nothing else moves it.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").uncheck();
  // Closing takes two presses on purpose — it happens once a month and there is
  // no single button that undoes it. The first names the consequence.
  await dialog.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  // Scoped to the dialog: Next's route announcer is a role="alert" too.
  await expect(dialog.getByRole("alert")).toContainText("Se cierra el resumen");
  await page.getByRole("button", { name: "Sí, cerrar y abrir" }).click();

  // The new statement is empty; the charge did not follow it.
  await expect(page.getByText("Sin gastos en este resumen.")).toBeVisible();
  await expect(page.getByText("Steam")).toBeHidden();

  // ...and stepping back to the closed one finds it exactly where it was.
  await page.getByRole("button", { name: "Resumen anterior" }).click();
  await expect(page.getByText("Resumen cerrado")).toBeVisible();
  await expect(page.getByText("Steam")).toBeVisible();

  /* Neither register touched the budget: the dashboard still reads $900. */
  await page.getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page.getByText("$900,00").first()).toBeVisible();
});

/**
 * The peso side of a card statement, and the warning when the month is over.
 *
 * The statement is billed in USD but the taxes are charged in ARS, so this
 * screen estimates them. The rate service is STUBBED here: a test that depends
 * on what the dollar did today is a test that fails for reasons that have
 * nothing to do with the code.
 */
test("a statement estimates its taxes in pesos, and says when it has closed", async ({
  page,
  request,
}) => {
  // A fixed quote, in dolarapi's own shape.
  await page.route("**/dolarapi.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        moneda: "USD",
        casa: "oficial",
        compra: 1450,
        venta: 1500,
        fechaActualizacion: "2026-08-28T18:55:00.000Z",
      }),
    }),
  );

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-ars-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("ARS Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Tarjetas", exact: true }).click();

  /* ── A statement whose closing date has already gone by ──────────────── */

  // Written straight into Firestore rather than through the dialog: the dialog
  // refuses to open a statement that closes before its own window starts, which
  // is correct — statements chain forward and only ever close in the future.
  // A statement that HAS closed can only be arrived at by time passing, so the
  // test has to arrive at it the same way, by planting one.
  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de ARS") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;
  await request.patch(
    `${REST}/households/${householdId}/cardStatements/2026-01-27`,
    {
      headers: admin,
      data: {
        fields: {
          startDate: { stringValue: "2025-12-28" },
          closingDate: { stringValue: "2026-01-27" },
          dueDate: { stringValue: "2026-02-07" },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );

  // A charge the bank has reported, on a card the household has configured as
  // credit — so the inbox offers it with a brand already chosen and the only
  // thing that can disable its button is the statement being closed.
  await request.patch(
    `${REST}/households/${householdId}?updateMask.fieldPaths=cards`,
    {
      headers: admin,
      data: {
        fields: {
          cards: {
            mapValue: {
              fields: {
                "5678": {
                  mapValue: {
                    fields: {
                      kind: { stringValue: "credit" },
                      // `brandFor` reads this, not `kind`: without it the
                      // inbox has no brand to file the charge under and its
                      // button is disabled for a reason that has nothing to do
                      // with the statement.
                      brand: { stringValue: "visa" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  );
  await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-closed`,
    {
      headers: admin,
      data: {
        fields: {
          usdCents: { integerValue: "4242" },
          date: { stringValue: "2026-08-20" },
          merchant: { stringValue: "TIENDA RARA" },
          cardLast4: { stringValue: "5678" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );

  // Charges are filed by their own date, so anything bought now belongs to the
  // NEXT statement — and the screen has to say so instead of silently
  // back-dating it into a month that is over.
  await expect(page.getByText("Este resumen ya cerró")).toBeVisible();
  // Same reason the inbox is frozen: the open statement has closed, so there
  // is no statement these can honestly go into.
  await expect(page.getByText("Cerrá el resumen antes de agregar")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: /Agregar US\$ 42,42/ }),
  ).toBeDisabled();
  // And again where the charge is actually being typed.
  await page.getByRole("button", { name: "Agregar gasto" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Cerrá el resumen y abrí el próximo",
  );
  await page.keyboard.press("Escape");

  /* ── The peso estimate, on an open one ───────────────────────────────── */

  // Closes far enough ahead that today cannot be past it, whenever the suite
  // happens to run.
  await page.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  await page.getByLabel("Cierre").fill("2099-12-27");
  await page.getByLabel("Vencimiento").fill("2100-01-07");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  await page.getByRole("button", { name: "Sí, cerrar y abrir" }).click();
  await expect(page.getByText("Este resumen ya cerró")).toBeHidden();
  await expect(page.getByText("Cerrá el resumen antes de agregar")).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Agregar US\$ 42,42/ }),
  ).toBeEnabled();

  // Nothing spent and no fee configured: no peso figure at all, rather than a
  // zero on a household with no Argentine card.
  const taxes = page.getByRole("button", { name: "Impuestos en pesos" });
  await expect(taxes).toBeHidden();

  await page.getByRole("button", { name: "Agregar gasto" }).click();
  // No warning this time: the statement is open and today is inside it.
  await expect(page.getByRole("dialog").getByRole("alert")).toBeHidden();
  await page.getByLabel("Monto (USD)").fill("100,00");
  await page.getByLabel("Detalle").fill("Steam");
  // Digital by default — nearly everything on this card is.
  await expect(page.getByLabel("Servicio digital del exterior")).toBeChecked();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Steam")).toBeVisible();

  // US$ 100 at 1500 is $150.000. RG 5617 takes 30% of it, and the two
  // digital-only lines take 21% and 2% of the same base: 79.500 in all, which
  // is the ONE figure the statement card carries.
  await expect(taxes).toBeVisible();
  await expect(page.getByText("$ 79.500,00")).toBeVisible();

  // The five lines live behind the "i" — read once a month, if that.
  await taxes.click();
  const taxDialog = page.getByRole("dialog");
  await expect(taxDialog.getByText("$ 45.000,00")).toBeVisible();
  await expect(taxDialog.getByText("$ 31.500,00")).toBeVisible();
  await expect(taxDialog.getByText("$ 3.000,00")).toBeVisible();
  await expect(taxDialog.getByText("Al dólar oficial $ 1.500")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(taxDialog).toHaveCount(0);

  // A shop is not a digital service: RG 5617 still applies to it, the other two
  // do not. US$ 50 more makes RG 5617 $67.500 while IIBB and RG 4240 stay put.
  await page.getByRole("button", { name: "Agregar gasto" }).click();
  await page.getByLabel("Monto (USD)").fill("50,00");
  await page.getByLabel("Detalle").fill("Kmart");
  await page.getByLabel("Servicio digital del exterior").uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Kmart")).toBeVisible();
  // 67.500 + 31.500 + 3.000
  await expect(page.getByText("$ 102.000,00")).toBeVisible();
  await taxes.click();
  await expect(taxDialog.getByText("$ 67.500,00")).toBeVisible();
  await expect(taxDialog.getByText("$ 31.500,00")).toBeVisible();

  // The monthly fee is typed once; its 21% IVA is worked out. Its settings
  // live in this dialog, beside the numbers they change — so the breakdown is
  // still open behind the fee form when it saves.
  await page.getByRole("button", { name: "Ajustes en pesos" }).click();
  await page.getByLabel("Comisión mensual (ARS)").fill("40.413,22");
  await page.getByRole("button", { name: "Guardar" }).click();
  // `.first()`: each line also prints the base it was computed from, so the
  // fee's amount appears twice — once as the charge, once inside "21% de ...".
  await expect(taxDialog.getByText("$ 40.413,22").first()).toBeVisible();
  await expect(taxDialog.getByText("$ 8.486,78")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(taxDialog).toHaveCount(0);
  // 40.413,22 + 8.486,78 + 3.000,00 + 31.500,00 + 67.500,00, on the card.
  await expect(page.getByText("$ 150.900,00")).toBeVisible();

  /* ── Closing carries the unchecked charges forward ───────────────────── */

  // Steam gets ticked off against the paper bill; Kmart does not. A charge
  // nobody could find on the statement probably was not on it, so closing
  // offers to carry it — which re-dates it, that being the only way a charge
  // moves between statements when it carries no statement id.
  // Ticked in the dialog the closed statement offers, not on the row: the list
  // is a list now, and reconciling is a once-a-month job that only makes sense
  // with the bank's paper in hand.
  //
  // Ticked through the admin API rather than the UI, and the reason is the
  // point of this test: ticking now lives in a dialog the screen offers once
  // the statement has CLOSED, because that is when the bank's paper arrives.
  // The statement here closes in 2100 on purpose — this test is about the
  // dates and the taxes — so there is no dialog to open, and the tick is a
  // fixture rather than the behaviour under test. What IS under test is what
  // closing does with a charge nobody could find on the paper.
  const cardCharges = await request.get(
    `${REST}/households/${householdId}/cardCharges`,
    { headers: admin },
  );
  const steam = (
    ((await cardCharges.json()).documents ?? []) as {
      name: string;
      fields: { detail?: { stringValue: string } };
    }[]
  ).find((d) => d.fields.detail?.stringValue === "Steam");
  expect(steam).toBeDefined();
  const steamId = (steam as { name: string }).name.split("/").pop() as string;
  const ticked = await request.patch(
    `${REST}/households/${householdId}/cardCharges/${steamId}` +
      `?updateMask.fieldPaths=verified`,
    {
      headers: admin,
      data: { fields: { verified: { booleanValue: true } } },
    },
  );
  expect(ticked.ok()).toBe(true);
  // Wait for the write to reach the screen: closing before it lands would
  // carry Steam across too, and the failure would look like a bug in the move.
  await expect(
    page.getByRole("button", { name: /Pasar 1 gasto|Cerrar y abrir el próximo/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  await page.getByLabel("Cierre").fill("2100-01-27");
  await page.getByLabel("Vencimiento").fill("2100-02-07");
  const closing = page.getByRole("dialog");
  await expect(closing.getByRole("checkbox")).toBeChecked();
  await expect(
    closing.getByText("Pasar el gasto sin comprobar al nuevo resumen"),
  ).toBeVisible();
  await closing
    .getByRole("button", { name: "Cerrar y abrir el próximo" })
    .click();
  await page.getByRole("button", { name: "Sí, cerrar y abrir" }).click();

  // The unchecked one came across; the checked one stayed where it was.
  await expect(page.getByText("Kmart")).toBeVisible();
  await expect(page.getByText("Steam")).toBeHidden();
  await page.getByRole("button", { name: "Resumen anterior" }).click();
  await expect(page.getByText("Steam")).toBeVisible();
  await expect(page.getByText("Kmart")).toBeHidden();
});

/**
 * Checking a closed statement off against the paper one the bank sends.
 *
 * The tick used to sit on every row of the main list, which put a once-a-month
 * job in front of you every day. It now lives in a dialog the screen offers
 * exactly when the statement has closed — because that is when the bank's
 * paper is in your hand — and once per statement per device, so a prompt
 * people would learn to dismiss does not appear on every visit.
 */
test("a closed statement offers its charges to be checked off, once", async ({
  page,
  request,
}) => {
  const email = `e2e-verify-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Verify Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de Verify") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;

  // Planted rather than opened through the dialog: a statement can only BE
  // closed by time passing, and the dialog refuses to open one in the past.
  const now = new Date().toISOString();
  await request.patch(
    `${REST}/households/${householdId}/cardStatements/2026-01-27`,
    {
      headers: admin,
      data: {
        fields: {
          startDate: { stringValue: "2025-12-28" },
          closingDate: { stringValue: "2026-01-27" },
          dueDate: { stringValue: "2026-02-07" },
          createdAt: { timestampValue: now },
          updatedAt: { timestampValue: now },
        },
      },
    },
  );
  for (const [id, detail, cents] of [
    ["chg-a", "STEAM", 1999],
    ["chg-b", "TEMU", 34243],
  ] as const) {
    await request.patch(`${REST}/households/${householdId}/cardCharges/${id}`, {
      headers: admin,
      data: {
        fields: {
          date: { stringValue: "2026-01-05" },
          detail: { stringValue: detail },
          card: { stringValue: "visa" },
          usdCents: { integerValue: String(cents) },
          digital: { booleanValue: true },
          verified: { booleanValue: false },
          createdBy: { stringValue: "seed" },
          createdAt: { timestampValue: now },
          updatedAt: { timestampValue: now },
        },
      },
    });
  }

  await page.getByRole("link", { name: "Tarjetas", exact: true }).click();

  // It offers ITSELF: the statement closed and two charges are unchecked.
  const dialog = page.getByRole("dialog", { name: "Comprobar el resumen" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("0 de 2 comprobados")).toBeVisible();

  // The whole row toggles, not a small target beside it.
  await dialog.getByRole("button", { name: /STEAM/ }).click();
  await expect(dialog.getByText("1 de 2 comprobados")).toBeVisible();
  await dialog.getByRole("button", { name: /TEMU/ }).click();
  await expect(dialog.getByText("2 de 2 comprobados")).toBeVisible();

  // Everything ticked, so the way out says so.
  await dialog.getByRole("button", { name: "Listo" }).click();
  await expect(dialog).toBeHidden();

  // The LIST is just a list. No tick beside a charge — the whole point.
  await expect(page.getByText("STEAM")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Comprobar contra el resumen/ }),
  ).toHaveCount(0);

  // And it does not ask again next visit.
  await page.reload();
  await expect(page.getByText("STEAM")).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toBeHidden();
});


/**
 * A service and the expense that paid it, linked by name.
 *
 * The register says what we expect to pay; the ledger says what was actually
 * charged. The link between them is the service's NAME inside the Servicios
 * category, and when the two disagree the expense wins — which is the whole
 * point of the reconcile button.
 */
test("a service is reconciled against the expense that paid it", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-svc-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("Svc Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // A monthly service, so it falls due whatever month the suite runs in.
  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Nombre").fill("Telefonía");
  await page.getByLabel("AUD").fill("45,00");
  await page.getByLabel("Día de vencimiento").fill("10");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText("Todavía no se cobró")).toBeVisible();
  await expect(page.getByText("0 de 1 servicios del mes")).toBeVisible();

  // A fresh household is seeded WITH the Servicios category, so there is
  // nothing to prompt about.
  await expect(page.getByText("Falta la categoría Servicios")).toBeHidden();

  // Cristian's household predates that category, and every household like it
  // would report "pendiente" forever with no way to find out why. Take the
  // category away to stand in for one of those, and the screen offers to
  // create the thing the link needs.
  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de Svc") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;
  // An updateMask naming a field that the body omits deletes exactly that one.
  await request.patch(
    `${REST}/households/${householdId}?updateMask.fieldPaths=categories.services`,
    { headers: admin, data: { fields: {} } },
  );
  await expect(page.getByText("Falta la categoría Servicios")).toBeVisible();
  await page.getByRole("button", { name: "Crearla" }).click();
  await expect(page.getByText("Falta la categoría Servicios")).toBeHidden();

  // The bill lands in Gastos, in that category, under the service's name —
  // accents and case included, which the matching has to survive.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByLabel("0,00", { exact: true }).fill("48,50");
  await page.getByLabel("Categoría: todas").selectOption("services");
  await page.getByLabel("Nota (opcional)").fill("telefonia");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("telefonia").first()).toBeVisible();

  // Back on Servicios it is linked, and the disagreement is named: the
  // register says 45,00, the bank said 48,50.
  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await expect(page.getByText(/^Cobrado el/)).toBeVisible();
  await expect(page.getByText("1 de 1 servicios del mes")).toBeVisible();
  await expect(page.getByText("El gasto dice $48,50")).toBeVisible();
  // "Cobrado este mes" follows the EXPENSE, "A pagar" the register.
  await expect(page.getByText("$48,50").first()).toBeVisible();

  // One tap moves the register onto what actually happened, for next month.
  await page.getByRole("button", { name: "Usar ese importe" }).click();
  await expect(page.getByText("El gasto dice $48,50")).toBeHidden();
  await expect(page.getByText(/^Cobrado el/)).toBeVisible();
});

/**
 * Stretching the week under way into a fortnight.
 *
 * The property worth pinning down is that NO expense is touched: one logged in
 * the days that were about to belong to the next period has to start counting
 * against this one the moment the boundary moves. That is what makes the whole
 * feature a single field update instead of a migration, and it is only true
 * because an expense stores a date rather than a period id.
 */
test("a week can be stretched into a fortnight, and swallows the days after it", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  const email = `e2e-extend-${Date.now()}@test.dev`;
  await page.evaluate((e) => window.__devSignIn!("Extend Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await expect(page.getByText("¿Cuánto por período?")).toBeVisible();
  // A WEEKLY household — extending is only offered on a week.
  await page.getByRole("tab", { name: "Semanal" }).click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // The next week, ALREADY materialized. Normally it does not exist yet —
  // periods are created lazily, on the day they begin — but it does whenever
  // the extension happens after it appeared, and that is the case this test is
  // here for: leaving it behind gives 8 of those days two budgets at once.
  // That is not hypothetical. It is what the production household carried for
  // three weeks: a fortnight 7–20 August beside the week 14–20.
  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de Extend") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;
  const swallowedStart = sydneyDate(7);
  await request.patch(
    `${REST}/households/${householdId}/periodBudgets/${swallowedStart}`,
    {
      headers: admin,
      data: {
        fields: {
          startDate: { stringValue: swallowedStart },
          endDate: { stringValue: sydneyDate(13) },
          period: { stringValue: "weekly" },
          amountCents: { integerValue: "90000" },
          source: { stringValue: "default" },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );

  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Extender a 2 semanas" }).click();

  // The dialog states the change as dates, and proposes the default budget.
  await expect(page.getByText("Pasaría a terminar")).toBeVisible();
  await page.getByLabel("Sumar al presupuesto").fill("900");
  await expect(page.getByText("$1.800,00")).toBeVisible();

  // One press is not enough: this cannot be undone.
  // Scoped to the dialog rather than `.last()`.
  //
  // Two buttons carry this name while the dialog is open: the offer on the
  // page behind it, and this one. `aria-modal` already tells assistive tech to
  // ignore the first, so the app is right and only Playwright sees both —
  // saying `within the dialog` is the same scoping the app declares, and it
  // fails loudly if the confirm button ever leaves the dialog, where `.last()`
  // would quietly click whatever ended up last.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Extender a 2 semanas" })
    .click();
  await expect(page.getByText(/no se puede deshacer/)).toBeVisible();
  await page.getByRole("button", { name: "Sí, extender el período" }).click();

  // The period is a fortnight now, and the offer is gone: it is one-way.
  await expect(page.getByRole("button", { name: "Extender a 2 semanas" })).toBeHidden();
  await expect(page.getByText("Iniciar la quincena")).toBeVisible();
  // The budget grew by exactly what was added.
  await expect(page.getByText("$1.800,00").first()).toBeVisible();

  // And the week it ran over is GONE, in the same write. Two periods claiming
  // the same days is not a cosmetic problem: an expense belongs to whichever
  // one the client's search returns first, and the clients search differently
  // — the web takes the first match, iOS the last — so they would disagree
  // about the budget for that week.
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets`,
        { headers: admin },
      );
      return (((await res.json()).documents ?? []) as { name: string }[])
        .map((d) => d.name.split("/").pop())
        .sort()
        .join(",");
    })
    .toBe(sydneyDate(0));
});

/**
 * Routing the bank's charges by which card they came from.
 *
 * The bank names a card exactly one way — "finalizada en 1234" — so the four
 * digits are the only thing that can tell a household expense from a line on a
 * credit-card statement. This walks the whole path: configure the cards, file
 * one charge on each, and prove each lands on its own screen and nowhere else.
 *
 * The third case is the one that matters most: a charge on a card nobody
 * configured appears in BOTH, because a charge that quietly picks the wrong
 * screen is a charge you lose.
 */
test("charges are routed by the card they came from", async ({ page, request }) => {
  const email = `e2e-cards-route-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Route Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const mine = ((await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[]).find((d) => d.fields.name.stringValue === "Hogar de Route");
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // The ingestion's job, by hand: one charge per card, plus one from a card
  // nobody has heard of.
  const charges: [string, number, string, string | null][] = [
    ["gmail-debit", 815, "COLES 0831", "1234"],
    ["gmail-credit", 1999, "STEAM", "5678"],
    ["gmail-orphan", 4242, "TIENDA RARA", "9999"],
  ];
  for (const [id, usdCents, merchant, last4] of charges) {
    await request.post(
      `${REST}/households/${householdId}/bankCharges?documentId=${id}`,
      {
        headers: admin,
        data: {
          fields: {
            usdCents: { integerValue: String(usdCents) },
            date: { stringValue: statsDate(0) },
            merchant: { stringValue: merchant },
            ...(last4 !== null ? { cardLast4: { stringValue: last4 } } : {}),
            importedAt: { timestampValue: new Date().toISOString() },
          },
        },
      },
    );
  }

  // Before any card is configured, everything is unidentified — so all three
  // show under Gastos. That is the state every household starts in.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("3 cargos del banco sin asignar")).toBeVisible({
    timeout: 20_000,
  });

  // Say which digits are which.
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Agregar tarjeta" }).click();
  await page.getByLabel("Últimos 4 dígitos").fill("1234");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("••1234")).toBeVisible();

  await page.getByRole("button", { name: "Agregar tarjeta" }).click();
  await page.getByLabel("Últimos 4 dígitos").fill("5678");
  await page.getByRole("tab", { name: "Crédito" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("••5678")).toBeVisible();

  // Gastos now offers the debit charge and the orphan — never the credit one.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("2 cargos del banco sin asignar")).toBeVisible();
  // No "Revisar" any more: the panel opens itself when something is waiting,
  // which is what pressing that used to be for. Waiting on a row instead of a
  // toggle also says what the test actually needs.
  await expect(page.getByRole("button", { name: /Descartar/ }).first())
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("COLES 0831")).toBeVisible();
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  await expect(page.getByText("STEAM")).toBeHidden();

  // Tarjetas offers the credit charge and the orphan — never the debit one.
  await page.getByRole("link", { name: "Tarjetas", exact: true }).click();
  await expect(page.getByText("STEAM")).toBeVisible();
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  await expect(page.getByText("COLES 0831")).toBeHidden();

  // No statement has been opened yet, so there is nowhere to file these: the
  // add buttons are dead and the screen says why, rather than looking broken.
  await expect(page.getByText("Cerrá el resumen antes de agregar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agregar US$ 19,99 · STEAM" }),
  ).toBeDisabled();

  // Recording one turns it into a card charge and retires the bank charge, so
  // it leaves the inbox for good rather than being offered twice.
  await page.getByRole("button", { name: "Abrir el primer resumen" }).click();
  await page.getByRole("button", { name: "Abrir resumen" }).click();
  await expect(page.getByText("Cerrá el resumen antes de agregar")).toBeHidden();
  await page.getByRole("button", { name: "Agregar US$ 19,99 · STEAM" }).click();
  // The orphan is still waiting — importing one charge must not retire another.
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  // And STEAM now appears exactly once: on the statement, no longer in the
  // inbox. Twice would mean the import created the line without retiring the
  // bank charge, which is the whole reason that write is a single batch.
  await expect(page.getByText("STEAM")).toHaveCount(1);
});

test("a recurring rule files the charge it recognises, and it can be taken back", async ({
  page,
  request,
}) => {
  const email = `e2e-rec-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Rec Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // The rule: anything the bank spells starting with OPAL, at $15.
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar" })
    .and(page.locator("xpath=preceding-sibling::*[1][text()]"))
    .or(page.getByRole("button", { name: "Agregar" }).last())
    .click();
  await page.getByRole("dialog").getByLabel("Texto del comercio").fill("Opal*");
  await page.getByRole("dialog").getByLabel("Cómo se llama el gasto").fill("Opal");
  await page.getByRole("dialog").getByRole("tab", { name: "Importe sugerido (AUD)" }).click();
  await page.getByRole("dialog").getByLabel("Importe sugerido (AUD)").fill("15,00");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Opal*")).toBeVisible();

  // The ingestion's job, by hand.
  const households = await request.get(`${REST}/households`, {
    headers: { Authorization: "Bearer owner" },
  });
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find((d) => d.fields.name.stringValue === "Hogar de Rec");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const created = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-opal1`,
    {
      headers: { Authorization: "Bearer owner" },
      data: {
        fields: {
          usdCents: { integerValue: "1240" },
          date: { stringValue: today },
          merchant: { stringValue: "OPAL AUCKLAND ST" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(created.ok()).toBe(true);

  // Coming back is what runs the rule: there is no server to run it.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Gastos recurrentes" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Se cargó 1 gasto solo")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Listo" }).click();

  // Filed at the rule's amount, with the bank's USD as its verification.
  await expect(page.getByText("Opal").first()).toBeVisible();
  // The row's own accessible name carries both figures, which is the tidiest
  // proof that the AUD came from the rule and the USD from the bank.
  await expect(
    page.getByRole("button", { name: /Verificado.*Opal, \$ ?15,00/ }),
  ).toBeVisible();
  await expect(page.getByText("US$ 12,40").first()).toBeVisible();
  // And the charge is NO LONGER waiting. This line was missing, which is what
  // made this the one test of the three that a split batch fools completely:
  // the expense commits either way, so the row above proves nothing about the
  // charge. It also makes the undo assertion at the end mean something — it
  // now reads as 0 charges then 1, rather than just 1 at the end.
  await expect(page.getByText(/cargo del banco sin asignar/)).toHaveCount(0);

  // Now the same two facts FROM THE SERVER, which is a NARROWER claim than it
  // looks — and narrower than the first version of this comment said.
  //
  // That version said a rules rejection "looks identical on screen". Measured
  // against the emulator with rules that allow the expense and deny the
  // charge's update, it does not: accepted gives row=1 panel=0 and denied
  // gives row=0 panel=1, both settled 150ms in, with no flash of the
  // optimistic echo in between. `fileChargeAsExpense` is ONE `writeBatch`, so
  // rejecting either half rolls back the whole thing and the listener reports
  // the rollback. The atomicity this app already guarantees is what makes the
  // cheap check sufficient. (Credit to the Stock session, which measured the
  // same claim false in its own suite first and said so.)
  //
  // So what this poll adds, exactly:
  //   - the fields no screen renders: `dismissedAt` present at all, `verified`
  //     true, the amount as integer cents rather than "$ 15,00" formatted;
  //   - not needing a screen assertion to win the race against the server ack;
  //   - and the one that earns its keep: it is what would notice if
  //     `fileChargeAsExpense` ever stopped being a single batch. Split into
  //     two awaits, the expense commits and is NOT rolled back, so the row
  //     renders and every assertion above passes — measured: row=1 with the
  //     charge still pending on the server. This test has no panel-count
  //     assertion, so the screen is fooled completely here; the other two
  //     catch it on the panel. Nothing else in the suite pins that atomicity.
  await expect
    .poll(async () => {
      const [charges, expenses] = await Promise.all([
        request.get(`${REST}/households/${householdId}/bankCharges/gmail-opal1`, {
          headers: admin,
        }),
        request.get(`${REST}/households/${householdId}/expenses`, { headers: admin }),
      ]);
      const charge = (await charges.json()) as {
        fields?: { dismissedAt?: unknown };
      };
      const filed = (((await expenses.json()).documents ?? []) as {
        fields: Record<string, { integerValue?: string; booleanValue?: boolean }>;
      }[]).find((d) => d.fields.usdCents?.integerValue === "1240");
      return [
        charge.fields?.dismissedAt === undefined ? "pending" : "dismissed",
        filed === undefined ? "no-expense" : filed.fields.amountCents?.integerValue,
        filed?.fields.verified?.booleanValue === true ? "verified" : "unverified",
      ].join("/");
    })
    .toBe("dismissed/1500/verified");

  // ...and it can be taken back, which puts the charge back in the list.
  await page
    .getByRole("button", { name: /Deshacer la carga automática/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /Verificado.*Opal/ }),
  ).toHaveCount(0);
  // The charge is waiting again — which is the whole point of the window: the
  // undo does not just delete an expense, it puts back the thing the expense
  // came from. (The panel is collapsed by default, so its header is what says
  // so on screen.)
  await expect(page.getByText("1 cargo del banco sin asignar")).toBeVisible();
});

test("restoring a charge filed OUTSIDE the range on screen does not count it twice", async ({
  page,
  request,
}) => {
  // The discarded list hides a charge that became an expense by looking for
  // that expense among the ones the screen has loaded — which is only the
  // range selected. A charge filed into any other range therefore shows up as
  // "1 descartado" with Restaurar, and Restaurar only cleared the stamp: the
  // charge went back to pending with its expense still in the ledger, the same
  // purchase counted twice. Not hypothetical — the rules catching up on a
  // charge from two days earlier put exactly this on a phone, and the iOS half
  // was fixed first while this one was left. The test next door asserts "not
  // listed as discarded" inside the range, which is the case that never broke.
  const email = `e2e-away-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Away Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find((d) => d.fields.name.stringValue === "Hogar de Away");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;

  // The rule by REST: making one through the UI is the test next door's job.
  const now = new Date().toISOString();
  const rule = await request.post(
    `${REST}/households/${householdId}/recurringRules?documentId=rule-away`,
    {
      headers: admin,
      data: {
        fields: {
          pattern: { stringValue: "Opal*" },
          categoryId: { stringValue: "transport" },
          note: { stringValue: "Opal" },
          amountAudCents: { integerValue: "1500" },
          createdBy: { stringValue: "e2e" },
          createdAt: { timestampValue: now },
          updatedAt: { timestampValue: now },
        },
      },
    },
  );
  expect(rule.ok()).toBe(true);
  const charge = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-away1`,
    {
      headers: admin,
      data: {
        fields: {
          usdCents: { integerValue: "1240" },
          date: { stringValue: sydneyDate() },
          merchant: { stringValue: "OPAL AUCKLAND ST" },
          importedAt: { timestampValue: now },
        },
      },
    },
  );
  expect(charge.ok()).toBe(true);

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("Se cargó 1 gasto solo")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Listo" }).click();

  // Look at LAST month, which does not contain today's expense.
  const [y, m] = sydneyDate().slice(0, 7).split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  await page.getByLabel("period").selectOption(`month:${lastMonth}`);

  // The filed charge is offered back, because nothing on screen says it was
  // filed. That offer is the premise of this test, not the bug: which list it
  // sits in is cosmetic. What Restaurar does to the ledger is not.
  await page.getByRole("button", { name: "1 descartado" }).click();
  await page.getByRole("button", { name: /^Restaurar US\$ 12,40$/ }).click();

  await expect
    .poll(async () => {
      const [c, e] = await Promise.all([
        request.get(`${REST}/households/${householdId}/bankCharges/gmail-away1`, {
          headers: admin,
        }),
        request.get(`${REST}/households/${householdId}/expenses/auto_gmail-away1`, {
          headers: admin,
        }),
      ]);
      const doc = (await c.json()) as { fields?: { dismissedAt?: unknown } };
      return [
        doc.fields?.dismissedAt === undefined ? "pending" : "dismissed",
        e.status() === 404 ? "no-expense" : "expense-still-there",
      ].join("/");
    })
    .toBe("pending/no-expense");
});

/**
 * A fresh household with one rule, created by REST — making a rule through the
 * UI is another test's job. Returns the household id.
 */
async function householdWithRule(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  who: string,
  rule: { pattern: string; note: string; categoryId: string; amountAudCents: number | null },
): Promise<string> {
  const email = `e2e-${who.toLowerCase()}-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate(([n, e]) => window.__devSignIn!(n, e), [`${who} Tester`, email]);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });
  const households = await request.get(`${REST}/households`, { headers: admin });
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find((d) => d.fields.name.stringValue === `Hogar de ${who}`);
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    pattern: { stringValue: rule.pattern },
    categoryId: { stringValue: rule.categoryId },
    note: { stringValue: rule.note },
    createdBy: { stringValue: "e2e" },
    createdAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
  };
  // Absent, not null, is how a rule says "ask me".
  if (rule.amountAudCents !== null) {
    fields.amountAudCents = { integerValue: String(rule.amountAudCents) };
  }
  const created = await request.post(
    `${REST}/households/${householdId}/recurringRules?documentId=rule-${who.toLowerCase()}`,
    { headers: admin, data: { fields } },
  );
  expect(created.ok()).toBe(true);
  return householdId;
}

async function postCharge(
  request: import("@playwright/test").APIRequestContext,
  householdId: string,
  id: string,
  merchant: string,
  usdCents: number,
): Promise<void> {
  const r = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=${id}`,
    {
      headers: admin,
      data: {
        fields: {
          usdCents: { integerValue: String(usdCents) },
          date: { stringValue: sydneyDate() },
          merchant: { stringValue: merchant },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(r.ok()).toBe(true);
}

test("two questions arriving together are both asked, not the first and then done", async ({
  page,
  request,
}) => {
  // The prompt read its questions LIVE while stepping an index forward, so
  // answering one took it out from under the index and the next slid into the
  // slot just passed: the second was never asked. Measured on iOS first — the
  // web had the same shape. The questions are captured when planned now.
  const householdId = await householdWithRule(page, request, "Asker", {
    pattern: "Cafe",
    note: "Café",
    categoryId: "coffee",
    amountAudCents: null,
  });
  await postCharge(request, householdId, "gmail-ask1", "CAFE MARTINEZ", 520);
  await postCharge(request, householdId, "gmail-ask2", "CAFE SOLO", 450);

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Gastos recurrentes" });
  await expect(dialog.getByText("CAFE MARTINEZ")).toBeVisible({ timeout: 20_000 });
  await dialog.getByLabel("Importe AUD").fill("7,00");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  // The one that used to be skipped.
  await expect(dialog.getByText("CAFE SOLO")).toBeVisible();
  await dialog.getByLabel("Importe AUD").fill("5,00");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  await expect
    .poll(async () => {
      const got: string[] = [];
      for (const id of ["gmail-ask1", "gmail-ask2"]) {
        const e = await request.get(`${REST}/households/${householdId}/expenses/auto_${id}`, {
          headers: admin,
        });
        got.push(e.status() === 200 ? "filed" : "missing");
      }
      return got.join("/");
    })
    .toBe("filed/filed");
});

test("a charge taken back with undo is not filed again when the next one arrives", async ({
  page,
  request,
}) => {
  // Undo puts the charge back in the pending list on purpose. The prompt was
  // handed every pending charge, so the next arrival opened it with the undone
  // one still claimable, and it was filed straight back.
  const householdId = await householdWithRule(page, request, "Undoer", {
    pattern: "Opal*",
    note: "Opal",
    categoryId: "transport",
    amountAudCents: 1500,
  });
  await postCharge(request, householdId, "gmail-undo1", "OPAL AUCKLAND ST", 1240);
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("Se cargó 1 gasto solo")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Listo" }).click();

  await page.getByRole("button", { name: /Deshacer la carga automática/ }).first().click();
  await expect(page.getByText("1 cargo del banco sin asignar")).toBeVisible();

  await postCharge(request, householdId, "gmail-undo2", "OPAL AUCKLAND ST", 1240);
  await expect(page.getByText("Se cargó 1 gasto solo")).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () => {
      const got: string[] = [];
      for (const id of ["gmail-undo1", "gmail-undo2"]) {
        const e = await request.get(`${REST}/households/${householdId}/expenses/auto_${id}`, {
          headers: admin,
        });
        got.push(e.status() === 200 ? "filed" : "not-filed");
      }
      return got.join("/");
    })
    .toBe("not-filed/filed");
});

test("a rule made from a charge files that charge on the spot", async ({
  page,
  request,
}) => {
  // The flow the icon exists for, and the one that used to change nothing
  // until the app was next opened: you see a charge you recognise, press the
  // icon on it, and the charge should be gone from the list when you close the
  // dialog — not still sitting there looking like the rule had not worked.
  const email = `e2e-onspot-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Spot Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, {
    headers: { Authorization: "Bearer owner" },
  });
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find((d) => d.fields.name.stringValue === "Hogar de Spot");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const created = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-spot1`,
    {
      headers: { Authorization: "Bearer owner" },
      data: {
        fields: {
          usdCents: { integerValue: "1240" },
          date: { stringValue: today },
          merchant: { stringValue: "OPAL AUCKLAND ST" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(created.ok()).toBe(true);

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("1 cargo del banco sin asignar")).toBeVisible({
    timeout: 20_000,
  });
  // The panel is collapsed by default; "Revisar" is what opens it.
  // No "Revisar" any more: the panel opens itself when something is waiting,
  // which is what pressing that used to be for. Waiting on a row instead of a
  // toggle also says what the test actually needs.
  await expect(page.getByRole("button", { name: /Descartar/ }).first())
    .toBeVisible({ timeout: 20_000 });

  // The icon ON the charge, named after it.
  await page
    .getByRole("button", { name: /Hacerlo recurrente — OPAL AUCKLAND ST/ })
    .click();

  const dialog = page.getByRole("dialog", { name: "Gastos recurrentes" });
  // Seeded with the whole merchant, which is the point of opening it here.
  await expect(dialog.getByLabel("Texto del comercio")).toHaveValue(
    "OPAL AUCKLAND ST",
  );
  await dialog.getByRole("tab", { name: "Importe sugerido (AUD)" }).click();
  await dialog.getByLabel("Importe sugerido (AUD)").fill("15,00");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  // No reload, no reopen: the charge is filed and the panel is empty.
  // Filed, verified, at the rule's amount and the bank's USD — and the note is
  // title-cased, because the bank shouts and a ledger should not.
  await expect(
    page.getByRole("button", {
      name: /Verificado.*Opal Auckland St, \$ ?15,00/,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("1 cargo del banco sin asignar")).toHaveCount(0);

  // And on the SERVER, all three: the rule saved, the charge dismissed, the
  // expense filed. This is the flow that shipped broken — the rule saved and
  // the charge sat there — so it is worth stating twice.
  //
  // What it adds over the screen is the narrow list in the first recurring
  // test above (fields nothing renders, no race, and the guard on the write
  // staying a single batch); it is NOT that the screen cannot see a rejection.
  // It can: the batch is atomic, so a rejected half rolls the whole thing
  // back. Measured, not assumed.
  await expect
    .poll(async () => {
      const [rules, charge, expenses] = await Promise.all([
        request.get(`${REST}/households/${householdId}/recurringRules`, {
          headers: admin,
        }),
        request.get(`${REST}/households/${householdId}/bankCharges/gmail-spot1`, {
          headers: admin,
        }),
        request.get(`${REST}/households/${householdId}/expenses`, { headers: admin }),
      ]);
      const rule = (((await rules.json()).documents ?? []) as {
        fields: { pattern?: { stringValue?: string } };
      }[]).find((d) => d.fields.pattern?.stringValue === "OPAL AUCKLAND ST");
      const filed = (((await expenses.json()).documents ?? []) as {
        fields: Record<string, { integerValue?: string }>;
      }[]).find((d) => d.fields.usdCents?.integerValue === "1240");
      return [
        rule === undefined ? "no-rule" : "rule",
        ((await charge.json()) as { fields?: { dismissedAt?: unknown } }).fields
          ?.dismissedAt === undefined
          ? "pending"
          : "dismissed",
        filed === undefined ? "no-expense" : filed.fields.amountCents?.integerValue,
      ].join("/");
    })
    .toBe("rule/dismissed/1500");
});

test("a charge with nothing to match is created as its own expense", async ({
  page,
  request,
}) => {
  // The case the button exists for. Before it, a charge with no counterpart
  // could only be DISCARDED — which says "this was not ours" about a real
  // purchase nobody had entered yet.
  const email = `e2e-create-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Create Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, {
    headers: { Authorization: "Bearer owner" },
  });
  const docs = (await households.json()).documents as {
    name: string;
    fields: { name: { stringValue: string } };
  }[];
  const mine = docs.find((d) => d.fields.name.stringValue === "Hogar de Create");
  expect(mine).toBeDefined();
  const householdId = (mine as { name: string }).name.split("/").pop() as string;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
  const created = await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-new1`,
    {
      headers: { Authorization: "Bearer owner" },
      data: {
        fields: {
          usdCents: { integerValue: "3250" },
          date: { stringValue: today },
          merchant: { stringValue: "BUNNINGS ALEXANDRIA" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(created.ok()).toBe(true);

  // The ledger is empty, so there is nothing this charge could be matched to.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();

  // The panel opens itself, because there is something waiting.
  await expect(
    page.getByRole("button", { name: /Crear gasto — BUNNINGS ALEXANDRIA/ }),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /Crear gasto — BUNNINGS ALEXANDRIA/ })
    .click();

  const dialog = page.getByRole("dialog", { name: "Crear gasto" });
  // Nothing verified yet, so there is no rate and no figure to suggest.
  await expect(dialog.getByLabel("Importe en AUD")).toHaveValue("");
  // The note is title-cased from what the bank shouted.
  await expect(dialog.getByLabel("Nota")).toHaveValue("Bunnings Alexandria");
  await dialog.getByLabel("Importe en AUD").fill("50,00");
  await dialog.getByRole("button", { name: "Crear gasto" }).click();

  // Filed, verified by the bank's own figure, and the charge is gone.
  await expect(
    page.getByRole("button", {
      name: /Verificado.*Bunnings Alexandria, \$ ?50,00/,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("US$ 32,50").first()).toBeVisible();
  await expect(page.getByText("1 cargo del banco sin asignar")).toHaveCount(0);

  // And it is NOT listed as discarded.
  //
  // Filing stamps `dismissedAt` on the charge, the same field "Descartar"
  // writes, so the charge landed in the discarded list offering "Restaurar" —
  // which only clears the stamp. Pressing it would have returned the charge to
  // pending and left this expense: the same purchase counted twice. Reported
  // from the phone, with a Big W charge sitting under "4 descartados" while
  // its expense showed verified a few rows below.
  await expect(page.getByText(/descartados?$/)).toHaveCount(0);

  // The server's version of the same sentence. Third batch in this feature,
  // third poll — for the reasons listed on the first one, which are narrower
  // than "the screen cannot tell": while this stays one batch, the screen can
  // tell. The poll is what keeps that true.
  await expect
    .poll(async () => {
      const [charge, expenses] = await Promise.all([
        request.get(`${REST}/households/${householdId}/bankCharges/gmail-new1`, {
          headers: admin,
        }),
        request.get(`${REST}/households/${householdId}/expenses`, { headers: admin }),
      ]);
      const filed = (((await expenses.json()).documents ?? []) as {
        fields: Record<string, { integerValue?: string; booleanValue?: boolean }>;
      }[]).find((d) => d.fields.usdCents?.integerValue === "3250");
      return [
        ((await charge.json()) as { fields?: { dismissedAt?: unknown } }).fields
          ?.dismissedAt === undefined
          ? "pending"
          : "dismissed",
        filed === undefined ? "no-expense" : filed.fields.amountCents?.integerValue,
        filed?.fields.verified?.booleanValue === true ? "verified" : "unverified",
      ].join("/");
    })
    .toBe("dismissed/5000/verified");
});

/**
 * A recurring rule that closes a service's month.
 *
 * These two features are deliberately separate collections — a service is
 * SCHEDULED and asks "has this month's arrived?", a rule is not scheduled at
 * all and fires when a charge lands — but they already meet, by name: an
 * expense in the Servicios category whose note IS the service's name is that
 * month's charge. A rule picks the note of what it files, so it could always
 * do this.
 *
 * What it could not do is tell you. The note is seeded with the merchant, so
 * the obvious rule for "GOOGLE YOUTUBEPREMIUM" files a note of "Google
 * Youtubepremium" and the service goes on saying it was never charged — while
 * the expense sits there, filed and correct. This walks the path that fixes
 * it: choosing the service from a list rather than typing its name.
 */
test("a recurring rule can be pointed at the service it pays", async ({
  page,
  request,
}) => {
  const email = `e2e-svcrule-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("SvcRule Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Nombre").fill("YouTube");
  await page.getByLabel("AUD").fill("11,99");
  await page.getByLabel("Día de vencimiento").fill("7");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Todavía no se cobró")).toBeVisible();

  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de SvcRule") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;
  await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-yt1`,
    {
      headers: admin,
      data: {
        fields: {
          usdCents: { integerValue: "780" },
          date: { stringValue: sydneyDate(0) },
          merchant: { stringValue: "GOOGLE YOUTUBEPREMIUM" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );

  // A COLD load, which is the condition the report came from: the service was
  // registered in some earlier session, not seconds ago in this one, so the
  // services listener starts from nothing rather than answering from cache.
  await page.goto("/gastos");
  await page.reload();
  await page
    .getByRole("button", { name: /Hacerlo recurrente — GOOGLE YOUTUBEPREMIUM/ })
    .click({ timeout: 20_000 });
  const dialog = page.getByRole("dialog", { name: "Gastos recurrentes" });

  // Free text until the category says Servicios, seeded with the merchant.
  await expect(dialog.getByLabel("Cómo se llama el gasto")).toHaveValue(
    "Google Youtubepremium",
  );
  await dialog.getByLabel("Categoría").selectOption({ label: "Servicios" });

  // Now it is the list, and nothing is selected: the seeded merchant is not a
  // service, and saying so is the whole point. Saving is refused until it is
  // answered, because a rule that files a note matching no service fails in
  // the one way nobody notices.
  const picker = dialog.getByLabel("Servicio que paga");
  await expect(picker).toBeVisible();
  await expect(dialog.getByLabel("Cómo se llama el gasto")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Guardar" })).toBeDisabled();

  await picker.selectOption({ label: "YouTube" });
  await dialog.getByRole("tab", { name: "Importe sugerido (AUD)" }).click();
  await dialog.getByLabel("Importe sugerido (AUD)").fill("11,99");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  // Filed on the spot, under the service's own name.
  await expect(
    page.getByRole("button", { name: /Verificado.*YouTube, \$ ?11,99/ }),
  ).toBeVisible({ timeout: 20_000 });

  // ...and that is what Servicios was waiting for.
  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await expect(page.getByText("Todavía no se cobró")).toHaveCount(0);
  await expect(page.getByText("1 de 1 servicios del mes")).toBeVisible();

  // The SECOND way a charge becomes a Servicios expense, and the one that was
  // missed: "Crear gasto" files it directly instead of through a rule. It
  // seeds the note with the merchant exactly the same way, so it had exactly
  // the same silent hole — the report that found it said the combo showed up
  // in Ajustes and not here.
  await request.post(
    `${REST}/households/${householdId}/bankCharges?documentId=gmail-yt2`,
    {
      headers: admin,
      data: {
        fields: {
          usdCents: { integerValue: "640" },
          date: { stringValue: sydneyDate(0) },
          merchant: { stringValue: "SPOTIFY AU" },
          importedAt: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Nombre").fill("Spotify");
  await page.getByLabel("AUD").fill("13,99");
  await page.getByLabel("Día de vencimiento").fill("3");
  await page.getByRole("button", { name: "Guardar" }).click();

  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page
    .getByRole("button", { name: /Crear gasto — SPOTIFY AU/ })
    .click({ timeout: 20_000 });
  const create = page.getByRole("dialog", { name: "Crear gasto" });
  await create.getByLabel("Categoría").selectOption({ label: "Servicios" });
  const servicePicker = create.getByLabel("Servicio que paga");
  await expect(servicePicker).toBeVisible();
  await expect(create.getByRole("button", { name: "Crear" })).toBeDisabled();
  await servicePicker.selectOption({ label: "Spotify" });
  await create.getByRole("button", { name: "Crear" }).click();

  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await expect(page.getByText("2 de 2 servicios del mes")).toBeVisible({
    timeout: 20_000,
  });
});

/**
 * Looking at the numbers without starting the period.
 *
 * The start-period screen is deliberately not dismissable: swiping it away
 * used to accept the default budget in silence, so the decision looked
 * optional when it is not. Asked for from the phone: a third way out for
 * "I want to check last period's figures before I choose".
 *
 * It writes nothing — the period stays materialized and unconfirmed, which is
 * the state it was already in — so the question still stands. What makes that
 * honest rather than a re-run of the old bug is the other half: adding an
 * expense is refused while it lasts, and refused by bringing the question
 * back rather than by failing quietly.
 */
test("the period can be left unstarted while the numbers are read", async ({
  page,
  request,
}) => {
  const email = `e2e-notyet-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("NotYet Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de NotYet") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;

  // Make this look like a device that was here before the period started,
  // which is what makes the screen come up by itself.
  await page.evaluate(
    ([id, older]) => localStorage.setItem(`gd:newPeriodAck:${id}`, older),
    [householdId, "2000-01-01"],
  );
  await page.reload();
  await expect(page.getByRole("button", { name: /Repetir presupuesto/ })).toBeVisible({
    timeout: 20_000,
  });

  // The way out that is not an answer.
  await page.getByRole("button", { name: "Todavía no arrancar" }).click();
  await expect(page.getByRole("button", { name: /Repetir presupuesto/ })).toHaveCount(0);

  // The app is usable — that is the whole request.
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  // And adding an expense brings the question back instead of writing.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByPlaceholder("0,00").first().fill("12,00");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("button", { name: /Repetir presupuesto/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/expenses`,
        { headers: admin },
      );
      return (((await res.json()).documents ?? []) as unknown[]).length;
    })
    .toBe(0);

  // Answering it lets the expense through — the refusal was about the
  // decision, not about the form. Typing it again and having it land is the
  // proof; asserting the screen merely closed would not distinguish "allowed
  // now" from "still refusing, quietly".
  await page.getByRole("button", { name: /Repetir presupuesto/ }).click();
  await expect(page.getByRole("button", { name: /Repetir presupuesto/ })).toHaveCount(0);
  await page.getByPlaceholder("0,00").first().fill("12,00");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/expenses`,
        { headers: admin },
      );
      return (((await res.json()).documents ?? []) as unknown[]).length;
    })
    .toBe(1);
});

/**
 * Linking a service to the expense that paid it, when the note says the bill.
 *
 * The link is the NAME and nothing is stored, so an expense filed under
 * Servicios with the note printed on the invoice — "Amaysim Internet Casa"
 * for a service registered as "Internet Casa" — reads as never charged, with
 * nothing saying why. Reported verbatim: "no encuentro la manera de
 * vincularlos". There was none.
 */
test("a service can be pointed at the expense that paid it", async ({
  page,
}) => {
  const email = `e2e-link-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Link Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Nombre").fill("Internet Casa");
  await page.getByLabel("AUD").fill("50,00");
  await page.getByLabel("Día de vencimiento").fill("13");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Todavía no se cobró")).toBeVisible();

  // The expense, noted the way the bill reads.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await page.getByPlaceholder("0,00").first().fill("50,00");
  await page
    .getByRole("combobox", { name: "Categoría: todas" })
    .first()
    .selectOption({ label: "Servicios" });
  await page.getByPlaceholder("Nota (opcional)").fill("Amaysim Internet Casa");
  await page.getByRole("button", { name: "Guardar" }).click();

  // Servicios still says it was never charged — the note names no service.
  await page.getByRole("link", { name: "Servicios", exact: true }).click();
  await expect(page.getByText("Todavía no se cobró")).toBeVisible({
    timeout: 20_000,
  });

  // ...and now it offers the expense instead of leaving you to guess.
  await expect(page.getByText("¿Lo pagaste con alguno de estos?")).toBeVisible();
  await expect(page.getByText(/Amaysim Internet Casa/)).toBeVisible();
  await page.getByRole("button", { name: "Es este" }).click();

  // One press links them: the service reads as charged.
  await expect(page.getByText("Todavía no se cobró")).toHaveCount(0);
  await expect(page.getByText("1 de 1 servicios del mes")).toBeVisible({
    timeout: 20_000,
  });
});

/**
 * The usual figure is not "adjusted", even when the carry-over is declined.
 *
 * Reported from the phone, reading a period that said "Semanal · $170
 * (ajustado)": "si siempre es 170, no está ajustado, sólo no acarreamos la
 * semana anterior". Exactly right — the badge sat beside the household's own
 * weekly figure and called it unusual.
 *
 * The cause was that `source` recorded which WRITE happened rather than what
 * the figure was. A household whose default carries the leftover materializes
 * the period at the usual amount plus whatever was left, so declining the
 * carry writes a different amount than the materialized one, took the
 * set-by-hand path, and stamped `custom`.
 */
test("repeating the budget without the leftover is not an adjustment", async ({
  page,
  request,
}) => {
  const email = `e2e-source-${Date.now()}@test.dev`;
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__devSignIn === "function");
  await page.evaluate((e) => window.__devSignIn!("Source Tester", e), email);
  await expect(page.getByText("¿Armamos el hogar?")).toBeVisible();
  await page.getByText("Crear nuestro hogar").click();
  await page.getByRole("button", { name: "Listo, a gastar con criterio" }).click();
  await expect(page.getByText("Te queda")).toBeVisible({ timeout: 20_000 });

  const households = await request.get(`${REST}/households`, { headers: admin });
  const householdId = (
    ((await households.json()).documents as {
      name: string;
      fields: { name: { stringValue: string } };
    }[]).find((d) => d.fields.name.stringValue === "Hogar de Source") as {
      name: string;
    }
  ).name
    .split("/")
    .pop() as string;

  // The default amount, whatever onboarding chose.
  const hh = await request.get(`${REST}/households/${householdId}`, {
    headers: admin,
  });
  const defaultCents = Number(
    ((await hh.json()) as {
      fields: {
        defaultBudget: {
          mapValue: { fields: { amountCents: { integerValue: string } } };
        };
      };
    }).fields.defaultBudget.mapValue.fields.amountCents.integerValue,
  );
  expect(defaultCents).toBeGreaterThan(0);

  // POLLED, not read once. The period is materialized lazily by the client
  // after onboarding, so reading straight through gets a response with no
  // `documents` at all and `[0].name` throws — which is how this failed on
  // CI while every local run passed, the runner being slower than the read.
  let start = "";
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets`,
        { headers: admin },
      );
      const docs = ((await res.json()).documents ?? []) as { name: string }[];
      start = docs[0]?.name.split("/").pop() ?? "";
      return docs.length;
    })
    .toBeGreaterThan(0);

  // Make the screen come up by itself, with a leftover to decline: the period
  // is put at the usual amount PLUS something, the way a carrying household
  // materializes it.
  await request.patch(
    `${REST}/households/${householdId}/periodBudgets/${start}` +
      `?updateMask.fieldPaths=amountCents&updateMask.fieldPaths=rolloverCents`,
    {
      headers: admin,
      data: {
        fields: {
          amountCents: { integerValue: String(defaultCents + 20000) },
          rolloverCents: { integerValue: "20000" },
        },
      },
    },
  );
  await page.evaluate(
    ([id]) => localStorage.setItem(`gd:newPeriodAck:${id}`, "2000-01-01"),
    [householdId],
  );
  await page.reload();

  // Decline the carry — the row is a toggle and it starts ticked off here, so
  // repeating gives the household's plain figure.
  await page.getByRole("button", { name: /Repetir presupuesto/ }).click();

  // The figure is the usual one, so the period is NOT marked adjusted.
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets/${start}`,
        { headers: admin },
      );
      const f = ((await res.json()) as {
        fields: {
          amountCents: { integerValue: string };
          source: { stringValue: string };
        };
      }).fields;
      return `${f.amountCents.integerValue}/${f.source.stringValue}`;
    })
    .toBe(`${defaultCents}/default`);
});
