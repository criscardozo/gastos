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
    await expect(page.getByLabel("0,00")).toHaveValue("");
    await page.getByLabel("0,00").fill(amount);
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
  await page.getByRole("button", { name: "Revisar" }).click();
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

  // Ticking the leftover moves the figure and the button.
  await page.getByText("Incluir lo que sobró").click();
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

  // It wrote both figures — the amount and what of it was carried in.
  await expect
    .poll(async () => {
      const res = await request.get(
        `${REST}/households/${householdId}/periodBudgets/${today}`,
        { headers: admin },
      );
      const fields = (await res.json()).fields as Record<
        string,
        { integerValue?: string; stringValue?: string }
      >;
      return [
        fields.amountCents?.integerValue,
        fields.rolloverCents?.integerValue,
        fields.source?.stringValue,
      ].join("/");
    })
    .toBe("110000/20000/custom");

  // Ajustes can bring the screen back, and that one CAN be dismissed.
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.getByRole("button", { name: /Iniciar la quincena/ }).click();
  await expect(page.getByText("Ahora no")).toBeVisible();
  await page.getByText("Ahora no").click();
  await expect(page.getByText(/Repetir presupuesto/)).toHaveCount(0);
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
  await expect(page.getByLabel("0,00")).toHaveValue("");

  // Cut the network the way a phone does. Firestore queues the write and
  // serves it straight back from the local cache — but its promise stays
  // pending until a server acknowledges, so anything awaiting it is stuck.
  await context.setOffline(true);
  await page.getByLabel("0,00").fill("12,50");
  await page.getByLabel("Nota (opcional)").fill("Sin señal");
  await page.getByRole("button", { name: "Guardar" }).click();

  // The expense is on screen, and the form is ready for the next one rather
  // than holding the amount hostage until the network comes back (which is how
  // a second tap turns into a duplicate expense).
  await expect(page.getByText("Sin señal").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel("0,00")).toHaveValue("");

  // And it really does reach the server once there is one.
  await context.setOffline(false);
  await expect(page.getByText("Sin señal").first()).toBeVisible();
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
  // Twice on screen on purpose: once in the row, once in the monthly summary
  // (a monthly service costs exactly its own amount per month).
  await expect(page.getByText("$22,99").first()).toBeVisible();
  await expect(page.getByText("US$ 14,99").first()).toBeVisible();
  // A monthly service costs its own amount per month — the summary is the
  // register's, and says so rather than pretending to be budget money.
  await expect(page.getByText("Por mes")).toBeVisible();

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

  // Cristian's real cycle: closes on the 27th, payable by the 7th.
  await page.getByRole("button", { name: "Abrir el primer resumen" }).click();
  await page.getByLabel("Cierre").fill("2026-08-27");
  await page.getByLabel("Vencimiento").fill("2026-09-07");
  await page.getByRole("button", { name: "Abrir resumen" }).click();
  await expect(page.getByText("Resumen actual")).toBeVisible();

  // A charge lands in the statement whose window holds its date.
  await page.getByRole("button", { name: "Agregar gasto" }).click();
  await page.getByLabel("Monto (USD)").fill("19,99");
  await page.getByLabel("Detalle").fill("Steam");
  await page.getByLabel("Fecha").fill("2026-08-11");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Steam")).toBeVisible();
  await expect(page.getByText("US$ 19,99").first()).toBeVisible();

  // Close it and open the next: both dates are proposed a month on, keeping
  // their day of the month, and the window starts the day after — so no charge
  // can fall between two statements.
  await page.getByRole("button", { name: "Cerrar y abrir el próximo" }).click();
  await expect(page.getByLabel("Cierre")).toHaveValue("2026-09-27");
  await expect(page.getByLabel("Vencimiento")).toHaveValue("2026-10-07");
  await page.getByRole("button", { name: "Abrir resumen" }).click();

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

  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Extender a 2 semanas" }).click();

  // The dialog states the change as dates, and proposes the default budget.
  await expect(page.getByText("Pasaría a terminar")).toBeVisible();
  await page.getByLabel("Sumar al presupuesto").fill("900");
  await expect(page.getByText("$1.800,00")).toBeVisible();

  // One press is not enough: this cannot be undone.
  await page.getByRole("button", { name: "Extender a 2 semanas" }).last().click();
  await expect(page.getByText(/no se puede deshacer/)).toBeVisible();
  await page.getByRole("button", { name: "Sí, extender el período" }).click();

  // The period is a fortnight now, and the offer is gone: it is one-way.
  await expect(page.getByRole("button", { name: "Extender a 2 semanas" })).toBeHidden();
  await expect(page.getByText("Iniciar la quincena")).toBeVisible();
  // The budget grew by exactly what was added.
  await expect(page.getByText("$1.800,00").first()).toBeVisible();
});

/**
 * Routing the bank's charges by which card they came from.
 *
 * The bank names a card exactly one way — "finalizada en 2024" — so the four
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
    ["gmail-debit", 815, "COLES 0831", "2024"],
    ["gmail-credit", 1999, "STEAM", "6576"],
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
  await page.getByLabel("Últimos 4 dígitos").fill("2024");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("••2024")).toBeVisible();

  await page.getByRole("button", { name: "Agregar tarjeta" }).click();
  await page.getByLabel("Últimos 4 dígitos").fill("6576");
  await page.getByRole("tab", { name: "Crédito" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("••6576")).toBeVisible();

  // Gastos now offers the debit charge and the orphan — never the credit one.
  await page.getByRole("link", { name: "Gastos", exact: true }).click();
  await expect(page.getByText("2 cargos del banco sin asignar")).toBeVisible();
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByText("COLES 0831")).toBeVisible();
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  await expect(page.getByText("STEAM")).toBeHidden();

  // Tarjetas offers the credit charge and the orphan — never the debit one.
  await page.getByRole("link", { name: "Tarjetas", exact: true }).click();
  await expect(page.getByText("STEAM")).toBeVisible();
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  await expect(page.getByText("COLES 0831")).toBeHidden();

  // Recording one turns it into a card charge and retires the bank charge, so
  // it leaves the inbox for good rather than being offered twice.
  await page.getByRole("button", { name: "Abrir el primer resumen" }).click();
  await page.getByRole("button", { name: "Abrir resumen" }).click();
  await page.getByRole("button", { name: "Agregar US$ 19,99 · STEAM" }).click();
  // The orphan is still waiting — importing one charge must not retire another.
  await expect(page.getByText("TIENDA RARA")).toBeVisible();
  // And STEAM now appears exactly once: on the statement, no longer in the
  // inbox. Twice would mean the import created the line without retiring the
  // bank charge, which is the whole reason that write is a single batch.
  await expect(page.getByText("STEAM")).toHaveCount(1);
});
