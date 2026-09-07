import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import es from "../../messages/es.json";
import en from "../../messages/en.json";

/**
 * Every key the code asks for exists in both languages.
 *
 * `useTranslations` returns the KEY itself when it misses, so a typo renders as
 * "expenses.note" on screen and nothing fails. That went out three times in one
 * day: a dialog title, a Done button, and two field labels — each found by
 * looking at the app, or by an e2e that happened to assert on the text.
 *
 * A scan rather than typed messages because it also catches the other
 * direction: a namespace that exists in one language and not the other.
 */

const SRC = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * The namespaces a file declares, including the root one.
 *
 * NOT which local name maps to which — a file can have two `t`s in different
 * function scopes bound to different namespaces (app/page.tsx does), and this
 * has no scope awareness. So a key counts as found if it resolves under ANY
 * namespace the file declares. That is weaker than it looks: a typo resolves
 * under none of them, which is the whole thing being caught, and pretending to
 * know the scope would make the test lie about what it checks.
 */
function namespacesOf(text: string): string[] {
  const out: string[] = [];
  // `useTranslations("ns")` and the bare `useTranslations()`, whose keys are
  // absolute.
  for (const m of text.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) {
    out.push(m[1]);
  }
  if (/useTranslations\(\s*\)/.test(text)) out.push("");
  return out;
}

/** Every literal key passed to a `t`-shaped call. */
function keysOf(text: string): string[] {
  // Only literal keys: a computed one cannot be checked from here, and
  // pretending otherwise would overstate the coverage.
  //
  // The name must start an identifier, not merely a word.
  //
  // With `\bt[A-Za-z]*\(` the first false positive was
  // `rate.toLocaleString("es-AR")`: the `.` is a word boundary, so `t` matched
  // there, `oLocaleString` matched `[A-Za-z]*`, and "es-AR" was reported as a
  // missing translation key. Requiring the preceding character not to be part
  // of an identifier — including the dot — is what distinguishes a call to `t`
  // from a method whose name happens to begin with one.
  const re = /(?<![A-Za-z0-9_$.])t[A-Za-z]*\(\s*"([^"]+)"/g;
  return [...text.matchAll(re)].map((m) => m[1]);
}

function lookup(
  messages: Record<string, unknown>,
  ns: string,
  key: string,
): unknown {
  let node: unknown = ns === "" ? messages : messages[ns];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("every key the code asks for", () => {
  const files = sources(SRC);

  it("scans a plausible number of files", () => {
    // A scan that found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(30);
  });

  it("finds a plausible number of keys", () => {
    const total = files.reduce(
      (n, f) => n + keysOf(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(200);
  });

  function missingIn(messages: Record<string, unknown>): string[] {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const spaces = namespacesOf(text);
      if (spaces.length === 0) continue;
      for (const key of keysOf(text)) {
        const found = spaces.some(
          (ns) => typeof lookup(messages, ns, key) === "string",
        );
        if (!found) missing.push(`${key} — ${file.slice(SRC.length + 1)}`);
      }
    }
    return missing;
  }

  it("resolves in Spanish", () => {
    expect(missingIn(es)).toEqual([]);
  });

  it("resolves in English too", () => {
    expect(missingIn(en)).toEqual([]);
  });
});
