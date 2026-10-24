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
//
// --fix deletes from PRODUCTION, so it asks first, the way `restore
// --production` does: a terminal, the project id typed back, and a backup
// taken in the last 24 hours (`pnpm backup`). It used to delete on the flag
// alone, and `--help` ran the production read too.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { ScriptError, run } from "./lib/errors.mjs";

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

/** The newest production backup in backups/, if one is under a day old. */
function recentBackup() {
  const dir = join(repoRoot, "backups");
  if (!existsSync(dir)) return null;
  const fresh = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f.includes("production"))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .filter(({ at }) => Date.now() - at < 24 * 3_600_000)
    .sort((a, b) => b.at - a.at);
  return fresh[0]?.f ?? null;
}

async function confirmFix() {
  const backup = recentBackup();
  if (backup === null) {
    throw new ScriptError(
      "--fix deletes from production: take a backup first (pnpm backup).\n" +
        "  No production backup under a day old in backups/. Nothing was deleted.",
    );
  }
  if (!process.stdin.isTTY) {
    throw new ScriptError("--fix asks for a typed confirmation and there is no terminal. Nothing was deleted.");
  }
  console.log(`\n--fix: borra en PRODUCCIÓN (${PROJECT_ID}). Backup de hoy: backups/${backup}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((settle, fail) => {
    rl.once("close", () => fail(new ScriptError("  Sin respuesta. No se borró nada.")));
    rl.question("  Escribí el id del proyecto para seguir: ", settle);
  });
  rl.close();
  if (answer.trim() !== PROJECT_ID) throw new ScriptError("  No coincide. No se borró nada.");
}

async function main() {
  if (fix) await confirmFix();
  // The credential decides which project this touches, so it is what gets
  // checked — not PROJECT_ID, which is a constant somebody could have edited
  // and which `projectId:` would happily accept alongside a key for something
  // else. Same defect the backup carried until today, and it matters more
  // here: with --fix this DELETES, and it deletes from production, which is
  // the only database it can reach.
  const serviceAccount = JSON.parse(readFileSync(credentialsPath(), "utf8"));
  if (serviceAccount.project_id !== PROJECT_ID) {
    console.error(
      `The service-account key is for "${serviceAccount.project_id}", not ` +
        `"${PROJECT_ID}". Refusing${fix ? " — nothing was deleted." : "."}`,
    );
    process.exit(1);
  }
  initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  const db = getFirestore();
  let problems = 0;
  let deleted = 0;
  // Problems still there when this ends: everything without --fix, and with it
  // whatever --fix will not touch (gaps, partial overlaps, answered periods).
  let remaining = 0;

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
        remaining += 1;
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
      if (!(fix && !p.answered)) remaining += 1;
    }

    // Anything overlapping only partially is a shape this script will not
    // guess at: which one is right depends on what somebody meant to do.
    for (let i = 1; i < periods.length; i += 1) {
      const previous = periods[i - 1];
      if (periods[i].id <= previous.end && periods[i].end > previous.end) {
        problems += 1;
        remaining += 1;
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
  // --fix used to exit 0 with gaps and partial overlaps still standing.
  process.exit(remaining > 0 ? 1 : 0);
}

run(main, {
  usage:
    "Usage: node scripts/check-periods.mjs [--fix]\n" +
    "  Without --fix it only reports. --fix asks for the project id and a backup\n" +
    "  under a day old before deleting anything.",
  flags: ["--fix"],
});
