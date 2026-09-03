#!/usr/bin/env node
//
// Fills the EMULATOR with a believable month, from OUTSIDE the app.
//
// Replaces an in-app seeder (DevSeed.swift) that did the same job at launch and
// cost a day finding out why: it deleted and recreated ten documents while the
// app was running, on the very collections the Servicios and Tarjetas screens
// then listened to, and on the Firebase iOS 12.x SDK those listeners never
// delivered again. Nothing real does that, so the fixture was breaking the
// thing it existed to make testable.
//
// Running here instead means the writes are FINISHED before the app launches,
// there is no burst against a live listener, and — because the emulator's admin
// endpoint bypasses security rules — no fighting `createdAt` being immutable.
// The delete-then-recreate that started all this simply is not needed.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore \
//        --config firebase/firebase.json --project qcris-gastos-diarios
//
//      The project id MUST be the app's own (the one in its
//      GoogleService-Info.plist). Start the suite under any other id and the
//      security rules resolve their `get()` in that other namespace, where no
//      household exists: `isMember()` then raises an EVALUATION ERROR rather
//      than returning false, and every subcollection gated by it — periods,
//      expenses, services, cards — comes back empty with no error at all. The
//      app looks like a household that has nothing in it. See docs/reglas.md.
//   2. launch the app once with `-useEmulators -devSignIn` so it creates its
//      auth account, and leave it on the onboarding screen
//   3. pnpm seed:emulator
//
// The app has a listener on `users/{uid}`, so it walks into a ready household
// on its own the moment step 3 writes one. No relaunch, and no writes from the
// app beyond its own user profile.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

// TWO project ids, and they are not interchangeable — measured, because the
// first version of this script asked the wrong one and got a truthful "no
// accounts" for an account that existed.
//
// The app carries the REAL project id in its GoogleService-Info.plist even when
// pointed at the emulators, and Firestore stores its documents under that id
// (with a `singleProjectMode` warning in the log). The AUTH emulator does not:
// it normalises everything to the project the suite was started with. So
// documents go to the app's id and accounts are read from the emulator's.
const PROJECT = process.env.SEED_PROJECT_ID ?? "qcris-gastos-diarios";
const AUTH_PROJECT = process.env.SEED_AUTH_PROJECT_ID ?? "qcris-gastos-diarios";

const TZ = "Australia/Sydney";

/**
 * Refuse to run against anything but a local emulator.
 *
 * The only thing making it safe to write a fixture into a database named after
 * the production project is that the host is localhost. So that is what gets
 * checked, rather than the project name — which would be theatre.
 */
function assertLocal() {
  for (const [name, host] of [["Firestore", FIRESTORE], ["Auth", AUTH]]) {
    const bare = host.replace(/^https?:\/\//, "").split(":")[0];
    if (bare !== "localhost" && bare !== "127.0.0.1" && bare !== "::1") {
      throw new Error(
        `${name} host is "${host}", which is not a local emulator. Refusing.`,
      );
    }
  }
}

const admin = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const docs = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;

/* ── Firestore's REST value encoding ───────────────────────────────────── */

/** JS value → the tagged shape the REST API wants. */
function value(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  // Integer vs double matters: the security rules check `is int`, and a
  // fee that arrives as 4041322.0 is refused. Same trap the Swift version hit
  // from the other direction, where a dictionary literal inferred Double.
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: fields(v) } };
}

function fields(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, value(v)]),
  );
}

/** Create or replace one document. Admin auth, so rules do not apply. */
async function put(path, data) {
  const response = await fetch(`${docs}/${path}`, {
    method: "PATCH",
    headers: admin,
    body: JSON.stringify({ fields: fields(data) }),
  });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
}

/** Delete one document. Same admin auth, so rules do not apply. */
async function remove(path) {
  const response = await fetch(`${docs}/${path}`, {
    method: "DELETE",
    headers: admin,
  });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
}

/** Ids of the documents in a collection, or [] when there are none. */
async function ids(collection) {
  const response = await fetch(`${docs}/${collection}`, { headers: admin });
  if (!response.ok) return [];
  const body = await response.json();
  return (body.documents ?? []).map((d) => d.name.split("/").pop());
}

/* ── Calendar dates, in the household's timezone ───────────────────────── */

/** Today as "YYYY-MM-DD" in the household timezone, never the machine's. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(shifted);
}

/** Same day of the month, `months` on, clamped to the target month's length. */
function addMonths(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = String(Math.min(d, last)).padStart(2, "0");
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

/* ── Who to seed for ───────────────────────────────────────────────────── */

/**
 * The uid the app signed in as.
 *
 * Read from the auth emulator rather than invented, because the app's
 * `-devSignIn` creates the account and the emulator picks the id. Asking for it
 * is also the check that the app really reached the emulator: a run that looks
 * signed in off a stale simulator keychain leaves ZERO accounts here.
 */
async function signedInUid() {
  // Both ids, because which one holds the account depends on the emulator's
  // singleProjectMode and getting it wrong reads as "nobody signed in".
  const tried = [AUTH_PROJECT, PROJECT];
  let userInfo = [];
  for (const project of tried) {
    const response = await fetch(
      `http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:query`,
      { method: "POST", headers: admin, body: "{}" },
    );
    if (!response.ok) continue;
    const body = await response.json();
    if ((body.userInfo ?? []).length > 0) {
      userInfo = body.userInfo;
      break;
    }
  }
  if (userInfo.length === 0) {
    throw new Error(
      "No accounts in the auth emulator. Launch the app once with " +
        "`-useEmulators -devSignIn` first — and if it looks signed in already, " +
        "that is the simulator keychain lying: `xcrun simctl erase` it.",
    );
  }
  const account =
    userInfo.find((u) => u.email === "simulador@test.dev") ?? userInfo[0];
  return { uid: account.localId, name: account.displayName ?? "Cristian" };
}

/* ── The fixture ───────────────────────────────────────────────────────── */

function seedCategories() {
  const path = fileURLToPath(
    new URL("../shared/categories.json", import.meta.url),
  );
  const { categories } = JSON.parse(readFileSync(path, "utf8"));
  return Object.fromEntries(
    categories.map((c) => [
      c.id,
      {
        key: c.key,
        icon: c.icon.material,
        color: c.color.light,
        sortOrder: c.sortOrder,
      },
    ]),
  );
}

async function main() {
  assertLocal();
  // Said out loud, first thing. This script writes under the PRODUCTION
  // project id — it has to, because that is the id the iOS app's plist carries
  // even when pointed at the emulators — and a log line naming that project
  // without naming the host reads exactly like an accident. What makes it safe
  // is the host, so the host goes on screen.
  console.log(`seeding the EMULATOR at ${FIRESTORE} (project "${PROJECT}")`);
  const { uid, name } = await signedInUid();
  const now = new Date();
  const day = today();
  const householdId = "seed-household";

  await put(`households/${householdId}`, {
    name: "Hogar de prueba",
    currency: "AUD",
    timezone: TZ,
    defaultBudget: {
      amountCents: 90000,
      period: "fortnightly",
      anchorDate: monthStart(day),
    },
    memberIds: [uid],
    memberProfiles: { [uid]: { displayName: name, color: "#2A6FDB" } },
    categories: seedCategories(),
    // The fixed monthly fee and a fallback rate, so the peso breakdown has all
    // five of its lines with no network in the simulator.
    cardFees: { commissionArsCents: 4041322, usdArsRate: 1514.0 },
    createdAt: now,
    updatedAt: now,
  });

  // Written with the FULL valid shape, `createdAt` included.
  //
  // Admin writes bypass the security rules, which is what makes this script
  // simple — and is also a footgun: the first version omitted `createdAt`, the
  // document went in happily, and then the app could not update its own
  // profile ever again ("Property createdAt is undefined on object"). A fixture
  // has to satisfy the rules even though nothing forces it to, or it writes
  // documents the app is locked out of.

  /* The start-period screen's own fixture: a period that ENDED yesterday
     having left money on the table, and a fresh one nobody has answered.
     Without these two docs the app materializes a single period covering
     today and the screen has nothing to ask about — so the three answers it
     offers (repeat, a different amount, stretch the previous one) could not be
     exercised at all. The previous one is confirmed because that is the real
     shape: somebody answered it a fortnight ago. */
  const previousStart = addDays(day, -14);
  const yesterday = addDays(day, -1);
  await put(`households/${householdId}/periodBudgets/${previousStart}`, {
    startDate: previousStart,
    endDate: yesterday,
    period: "fortnightly",
    amountCents: 90000,
    source: "custom",
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await put(`households/${householdId}/periodBudgets/${day}`, {
    startDate: day,
    endDate: addDays(day, 13),
    period: "fortnightly",
    amountCents: 90000,
    source: "default",
    createdAt: now,
    updatedAt: now,
  });
  // Anything else in there is the APP's, not ours, and it has to go.
  //
  // The app is listening the whole time this script runs, and the household
  // above lands before these two periods do — so between the two writes it is
  // free to materialize a period of its own from the anchor date. That is not
  // harmless: periods must not overlap, and three ranges covering today make
  // "the current period" whichever one the sort happened to put last. Which is
  // exactly what it did on the first run of this fixture, leaving the
  // start-period screen offering to stretch a period nobody had asked about.
  // The web's e2e suite learned the same lesson the same way.
  for (const id of await ids(`households/${householdId}/periodBudgets`)) {
    if (id !== previousStart && id !== day) {
      await remove(`households/${householdId}/periodBudgets/${id}`);
    }
  }

  // 700,00 of the 900,00 spent, so 200,00 is left to carry or to stretch.
  await put(`households/${householdId}/expenses/exp-anterior`, {
    amountCents: 70000,
    categoryId: "groceries",
    note: "Del período anterior",
    date: yesterday,
    createdBy: uid,
    verified: false,
    createdAt: now,
    updatedAt: now,
  });

  /* Servicios — three bills covering every state the screen can show: one
     charged for exactly what we expected, one charged for MORE (which is what
     puts the reconcile button on screen), one this month does not charge. */
  const month = Number(day.slice(5, 7));
  const services = [
    ["svc-netflix", "Netflix", 2299, 1499, "monthly", 7, undefined],
    ["svc-telefonia", "Telefonía", 4500, undefined, "monthly", 12, undefined],
    ["svc-seguro", "Seguro auto", 62000, undefined, "quarterly", 15,
      month === 12 ? 1 : month + 1],
  ];
  for (const [id, sName, aud, usd, interval, dueDay, anchorMonth] of services) {
    await put(`households/${householdId}/services/${id}`, {
      name: sName,
      amountAudCents: aud,
      amountUsdCents: usd,
      interval,
      dueDay,
      anchorMonth,
      paidWith: "debit",
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    });
  }

  // The expenses that pay two of them. Netflix for exactly what is on file;
  // Telefonía for 48,50 against 45,00, which is the disagreement the screen
  // offers to resolve.
  for (const [id, note, cents] of [
    ["exp-netflix", "Netflix", 2299],
    ["exp-telefonia", "Telefonía", 4850],
  ]) {
    await put(`households/${householdId}/expenses/${id}`, {
      amountCents: cents,
      categoryId: "services",
      note,
      date: addDays(monthStart(day), 2),
      createdBy: uid,
      verified: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  /* Tarjetas — an open statement with four charges, three digital and one not,
     so the peso breakdown has both of its bases to show, and one already ticked
     off against the paper bill. */
  const start = addDays(day, -20);
  const closing = addMonths(day, 1);
  await put(`households/${householdId}/cardStatements/${closing}`, {
    startDate: start,
    closingDate: closing,
    dueDate: addMonths(addDays(day, 10), 1),
    createdAt: now,
    updatedAt: now,
  });

  const charges = [
    ["chg-steam", "STEAM", "visa", 1999, true, true],
    ["chg-didi", "DiDiMobility", "visa", 1718, true, false],
    ["chg-temu", "TEMU.COM", "mastercard", 34243, true, false],
    ["chg-kmart", "KMART", "visa", 12252, false, false],
  ];
  for (const [i, [id, detail, card, usdCents, digital, verified]] of charges.entries()) {
    await put(`households/${householdId}/cardCharges/${id}`, {
      date: addDays(start, i + 1),
      detail,
      card,
      usdCents,
      digital,
      verified,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Last, in the sense that matters: the app watches this document, so writing
  // householdId is what takes it out of onboarding — with everything above
  // already in place.
  await put(`users/${uid}`, {
    displayName: name,
    householdId,
    language: "es",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`seeded ${householdId} for ${uid} (${PROJECT} @ ${FIRESTORE})`);
  console.log("  2 períodos · 3 servicios · 3 gastos · 1 resumen · 4 cargos");
}

main().catch((error) => {
  console.error(`seed failed: ${error.message}`);
  process.exit(1);
});
