import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MAX_AMOUNT_CENTS } from "./money";
import {
  MAX_BUDGET_AMOUNT_CENTS,
  MAX_HOUSEHOLD_NAME_CHARACTERS,
  MAX_NOTE_CHARACTERS,
} from "./limits";

/**
 * Every ceiling the rules enforce, read from the three places that hold it.
 *
 * Not three assertions of the same literal. `categories.test.ts` already used
 * this shape for the category cap, and the caps below did not have it — which
 * is how the entry form on iOS came to accept a $9.999.999 expense and a note
 * of any length, both of which the rules refuse. The web had already been
 * fixed (see MAX_AMOUNT_CENTS in money.ts, whose comment describes the same
 * defect) and the fix was never carried across.
 *
 * The direction that hurts is a client LOOSER than the rules: the screen takes
 * the value, Firestore's local cache shows the expense saved, and the
 * write-error alert arrives for something the field could have refused. A
 * client stricter than the rules is only an annoyance.
 */

const root = join(import.meta.dirname, "../../../..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** The single number a rules expression caps something at. */
function ruleCap(source: string, pattern: RegExp): number {
  const match = source.match(pattern);
  expect(match, `not found in firestore.rules: ${pattern}`).not.toBeNull();
  return Number(match![1]);
}

const rules = read("firebase/firestore.rules");
const limitsSwift = read("apps/ios/GastosDiarios/Core/Limits.swift");

function swiftLimit(name: string): number {
  const match = limitsSwift.match(
    new RegExp(`static let ${name} = ([\\d_]+)`),
  );
  expect(match, `not found in Limits.swift: ${name}`).not.toBeNull();
  return Number(match![1].replaceAll("_", ""));
}

describe("the ceiling on an expense amount", () => {
  it("is the one the rules enforce", () => {
    expect(MAX_AMOUNT_CENTS).toBe(
      ruleCap(rules, /data\.amountCents > 0 && data\.amountCents <= (\d+)\s*$/m),
    );
  });

  it("is the one the iOS keypad refuses to cross", () => {
    expect(swiftLimit("maxExpenseAmountCents")).toBe(MAX_AMOUNT_CENTS);
  });
});

describe("the ceiling on a budget", () => {
  it("is the one the rules enforce", () => {
    expect(MAX_BUDGET_AMOUNT_CENTS).toBe(
      ruleCap(rules, /budget\.amountCents > 0 && budget\.amountCents <= (\d+)/),
    );
  });

  it("is the one the iOS budget editors refuse to cross", () => {
    expect(swiftLimit("maxBudgetAmountCents")).toBe(MAX_BUDGET_AMOUNT_CENTS);
  });

  it("is looser than the ledger's, because it holds a fortnight of them", () => {
    expect(MAX_BUDGET_AMOUNT_CENTS).toBeGreaterThan(MAX_AMOUNT_CENTS);
  });
});

describe("the ceiling on a note", () => {
  it("is the one the rules enforce", () => {
    expect(MAX_NOTE_CHARACTERS).toBe(
      ruleCap(rules, /data\.note is string && data\.note\.size\(\) <= (\d+)/),
    );
  });

  it("is the one the iOS field stops taking", () => {
    expect(swiftLimit("maxNoteCharacters")).toBe(MAX_NOTE_CHARACTERS);
  });

  it("is on EVERY web field that takes a note, not just the entry one", () => {
    // The constant is only worth having if the fields use it — and a cap can
    // be missing from one form while another has it. That is the harder gap
    // to see, because neither file mentions the other.
    for (const path of [
      "apps/web/src/app/nuevo/page.tsx",
      // The edit form's fields, which used to sit at the top of
      // gastos/page.tsx and moved here when that file was split. This test
      // caught the move — which is the point of naming the file rather than
      // grepping the whole tree.
      "apps/web/src/app/gastos/pieces.tsx",
    ]) {
      expect(read(path), path).toContain("maxLength={MAX_NOTE_CHARACTERS}");
    }
  });
});

describe("the ceiling on a household name", () => {
  it("is the one the rules enforce", () => {
    expect(MAX_HOUSEHOLD_NAME_CHARACTERS).toBe(
      ruleCap(rules, /data\.name is string && data\.name\.size\(\) >= 1 && data\.name\.size\(\) <= (\d+)/),
    );
  });

  it("is the one the iOS rename field stops taking", () => {
    expect(swiftLimit("maxHouseholdNameCharacters")).toBe(
      MAX_HOUSEHOLD_NAME_CHARACTERS,
    );
  });

  it("is on BOTH web forms that name a household", () => {
    // Onboarding names the household and Ajustes renames it. Only the second
    // capped it, which is the same field decided once and applied once.
    for (const path of [
      "apps/web/src/app/ajustes/page.tsx",
      "apps/web/src/components/onboarding/onboarding.tsx",
    ]) {
      expect(read(path), path).toContain(
        "maxLength={MAX_HOUSEHOLD_NAME_CHARACTERS}",
      );
    }
  });
});
