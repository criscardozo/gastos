import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A radius that has a NAME has to be referenced by it.
 *
 * This guard exists because tokenising a value turns off the one that was
 * already watching it. `design-system/emit.py --verify` asks whether a radius
 * the code uses a lot is in `tokens.json`; it does not ask whether the call
 * site goes through the token. So the moment `18` became `card`, twenty-five
 * hand-written `cornerRadius: 18` stopped being a finding and became "in
 * scale" — the check went quiet about exactly the thing the pass was for.
 * Measured before writing this: eight uses of a radius that is not a token get
 * named, the same eight as a value that IS a token produce no output at all.
 *
 * So this asks the other question. It was written BEFORE the call sites were
 * converted, so its first run failed on its own with fifty literals in front
 * of it — which is the positive control, taken for free by writing the guard
 * first instead of after.
 *
 * SCOPE, stated rather than implied: the app target only. `GastosWidget` is
 * outside on purpose — four of its five `cornerRadius` are geometry of a drawn
 * mark (`8.5 * s`, the piggy), and a sweep that pulled those in would be
 * putting 2.3px into a scale of UI radii. Its one real UI radius, a 7px in
 * BudgetWidget, is therefore NOT covered by anything. That is a known hole and
 * it is written down as one.
 */
describe("iOS radii with a role", () => {
  const ROOT = join(import.meta.dirname, "../../../..");

  /** Role → px, read from the token file rather than spelled out here. */
  const ROLES: Record<string, number> = Object.fromEntries(
    Object.entries(
      JSON.parse(readFileSync(join(ROOT, "design-system/tokens.json"), "utf8")).radius,
    )
      .filter(([name, e]) => typeof e === "object" && e !== null && !/^r\d+$/.test(name) && name !== "full")
      .map(([name, e]) => [name, parseFloat((e as { $value: string }).$value)]),
  );

  /**
   * Sites that draw one of those numbers for something that is NOT that role.
   * Named by what they draw, because a role is what a value is FOR and two
   * roles are allowed to land on the same number: a filled button at 18 is not
   * a card at 18, and pointing it at `Theme.card` would assert a relationship
   * nobody decided — the next person moving the card would move the button.
   *
   * The three backgrounds here are buttons (`accentSoft` twice, `ink` once)
   * and one pill that stops being a pill at accessibility text sizes. Buttons
   * draw at 18 AND at 12 today, which is the same "one role, several numbers"
   * this pass just fixed for the card, one role over. It is not fixed here
   * because nobody has decided it.
   *
   * Matched against the line IMMEDIATELY before the radius, which is the
   * `.background(...)` that shape is clipping, and not against a window around
   * it. The first version looked at five lines and exempted everything: one of
   * the patterns was `Theme.ink`, which is the app's text colour and therefore
   * within three lines of nearly every card in it. It passed with eight
   * unconverted literals in front of it, and the check meant to notice that
   * — "did the exemptions match too much" — was a threshold of ten.
   */
  const NOT_A_ROLE = [
    ".background(Theme.accentSoft)",
    ".background(Theme.ink)",
    "AnyShape = ",
  ];

  it("are referenced by name, not written as numbers", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "apps/ios/Gastos"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\0")
      .filter((f) => f.endsWith(".swift") && !f.endsWith("Design/Theme.swift"));

    expect(files.length, "no Swift sources found — wrong path or a shallow checkout").toBeGreaterThan(20);

    const values = new Set(Object.values(ROLES));
    expect(values.size, "tokens.json declares no radius roles").toBeGreaterThan(2);

    const offenders: string[] = [];
    let exempted = 0;
    for (const file of files) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("//")) return;
        const m = /cornerRadius: ([0-9.]+)/.exec(line);
        if (!m || !values.has(parseFloat(m[1]))) return;
        // Read from the line that sets the background this shape clips, not
        // from a window: a window matched the whole app (see NOT_A_ROLE).
        const near = `${lines[i - 1] ?? ""}\n${line}`;
        if (NOT_A_ROLE.some((k) => near.includes(k))) {
          exempted += 1;
          return;
        }
        const role = Object.keys(ROLES).find((r) => ROLES[r] === parseFloat(m[1]));
        offenders.push(`${file}:${i + 1} — write Theme.${role} instead of ${m[1]}`);
      });
    }

    // Reported rather than asserted: a number that has to stay at 4 forever is
    // a guard that fails on a legitimate change. What must not happen is it
    // quietly becoming everything.
    expect(
      exempted,
      "every site was exempted — the exemption patterns are matching too much",
    ).toBeLessThan(10);

    expect(
      offenders,
      `these draw a radius that has a name, as a number:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
