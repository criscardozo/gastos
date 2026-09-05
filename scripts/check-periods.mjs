#!/usr/bin/env node
// Do the household's periods form one clean chain?
//
// Periods are supposed to tile the calendar: each starts the day after the
// previous one ends, none overlaps, none is missing. Two of them claiming the
// same days is not cosmetic — an expense belongs to whichever period the
// client's search returns first, and the clients search differently (the web
// takes the first match, iOS the last), so the two apps disagree about which
// budget those days count against.
//
// That happened: extending a week into a fortnight moved the boundary without
// removing the week it ran over, because the rules forbade deleting a period
// at the time. The extension was fixed to delete in the same batch; this is
// how the damage already written gets found and cleared.
//
// Usage:
//   node scripts/check-periods.mjs          # report only (default)
//   node scripts/check-periods.mjs --fix    # delete the redundant ones
//
// --fix only ever removes a period that is BOTH unanswered (no confirmedAt,
// which is the same condition the security rules enforce) and entirely covered
// by another. Anything else is reported and left alone.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "qcris-gastos-diarios";
const fix = process.argv.includes("--fix");

function credentialsPath() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fallback = join(repoRoot, "firebase", "service-account.json");
  const path = explicit ?? (existsSync(fallback) ? fallback : null);
  if (path === null) {
    console.error(
      "No service account key found. Set GOOGLE_APPLICATION_CREDENTIALS, or\n" +
        "place the key at firebase/service-account.json (gitignored).",
    );
    process.exit(1);
  }
  return path;
}

/** `date + 1` as a calendar date, with no timezone anywhere near it. */
function nextDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + 1));
  return shifted.toISOString().slice(0, 10);
}

async function main() {
  initializeApp({
    credential: cert(JSON.parse(readFileSync(credentialsPath(), "utf8"))),
    projectId: PROJECT_ID,
  });
  const db = getFirestore();
  let problems = 0;
  let deleted = 0;

  for (const household of (await db.collection("households").get()).docs) {
    const snapshot = await household.ref
      .collection("periodBudgets")
      .orderBy("startDate")
      .get();
    const periods = snapshot.docs.map((doc) => ({
      id: doc.id,
      end: doc.data().endDate,
      cents: doc.data().amountCents,
      type: doc.data().period,
      answered: doc.data().confirmedAt != null,
      ref: doc.ref,
    }));
    console.log(
      `\n${household.data().name} — ${periods.length} períodos` +
        ` (${household.id})`,
    );

    for (const p of periods) {
      console.log(
        `  ${p.id} → ${p.end}  $${(p.cents / 100).toFixed(2).padStart(9)}` +
          `  ${p.type.padEnd(12)}${p.answered ? "confirmado" : "sin confirmar"}`,
      );
    }

    // Gaps: reported, never touched. A missing period is not something a
    // script should invent — materialization does that, from the last one.
    for (let i = 1; i < periods.length; i += 1) {
      const expected = nextDay(periods[i - 1].end);
      if (periods[i].id > expected) {
        problems += 1;
        console.log(
          `  ! hueco entre ${periods[i - 1].end} y ${periods[i].id}` +
            ` (faltaría uno desde ${expected})`,
        );
      }
    }

    // Overlaps: a period entirely inside another is redundant and removable.
    for (const p of periods) {
      const cover = periods.find(
        (other) =>
          other.id !== p.id && other.id <= p.id && other.end >= p.end,
      );
      if (cover === undefined) continue;
      problems += 1;
      const why = p.answered
        ? "está confirmado — lo contestó alguien, así que queda"
        : "sin confirmar y cubierto entero";
      console.log(`  ! ${p.id} → ${p.end} sobra: ${why}`);
      console.log(`      lo cubre ${cover.id} → ${cover.end}`);
      if (fix && !p.answered) {
        await p.ref.delete();
        deleted += 1;
        console.log(`      BORRADO`);
      }
    }

    // Anything overlapping only partially is a shape this script will not
    // guess at: which one is right depends on what somebody meant to do.
    for (let i = 1; i < periods.length; i += 1) {
      const previous = periods[i - 1];
      if (periods[i].id <= previous.end && periods[i].end > previous.end) {
        problems += 1;
        console.log(
          `  ! ${previous.id}→${previous.end} y ${periods[i].id}→${periods[i].end}` +
            ` se pisan en parte — a mano`,
        );
      }
    }
  }

  console.log(
    `\n${problems} problema(s)` +
      (fix
        ? `, ${deleted} borrado(s)`
        : problems > 0
          ? " — corré con --fix para borrar los redundantes"
          : ""),
  );
  process.exit(problems > 0 && !fix ? 1 : 0);
}

main().catch((error) => {
  console.error("check-periods failed:", error.message);
  process.exit(1);
});
