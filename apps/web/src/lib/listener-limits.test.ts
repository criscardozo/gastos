import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every bounded listener asks for the SAME documents on both clients.
 *
 * A listener with a `limit` takes the first N documents in some order, so the
 * order field, its direction and N together decide WHICH documents a client
 * sees. The two clients had drifted on all three: services 60 on the web and
 * 100 on iOS, card statements 13 against 24, and iOS listening to services and
 * recurring rules in no order at all — so past the cap each client would have
 * held a different subset and disagreed about what exists. providers.tsx
 * already made that argument for the periods; this holds it for all of them.
 *
 * Both sides are READ from the source rather than written here — a list typed
 * into this file would be one more copy to keep in step. The population is
 * derived from the code on each side and compared both ways, so a listener
 * added to one client without the other fails by name.
 */

const ROOT = join(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

interface Bound {
  order: string;
  limit: number;
}

/** Web: each `collection(…, "name")` query up to the next one. */
function webBounds(): Map<string, Bound> {
  const out = new Map<string, Bound>();
  for (const file of ["apps/web/src/lib/firebase/hooks.ts", "apps/web/src/components/providers.tsx"]) {
    const text = read(file);
    const consts = new Map(
      [...text.matchAll(/const (\w+) = (\d+);/g)].map((m) => [m[1], Number(m[2])]),
    );
    const starts = [...text.matchAll(/collection\([^)]*"(\w+)"\)/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? (starts[i + 1].index as number) : text.length;
      const query = text.slice(m.index as number, end);
      const limit = query.match(/limit\((\w+)\)/);
      if (limit === null) return; // bounded by date instead, or not a listener
      const order = query.match(/orderBy\("(\w+)"(?:,\s*"(asc|desc)")?\)/);
      const value = /^\d+$/.test(limit[1]) ? Number(limit[1]) : consts.get(limit[1]);
      expect(value, `${file}: ${m[1]} limit ${limit[1]} resolves to a number`).toBeDefined();
      out.set(m[1], {
        order: order === null ? "(none)" : `${order[1]} ${order[2] ?? "asc"}`,
        limit: value as number,
      });
    });
  }
  return out;
}

/** iOS: each `func listen…` in FirestoreService.swift. */
function iosBounds(): Map<string, Bound> {
  const out = new Map<string, Bound>();
  const text = read("apps/ios/Gastos/Services/FirestoreService.swift");
  for (const chunk of text.split(/func listen/).slice(1)) {
    const body = chunk.slice(0, chunk.indexOf("addSnapshotListener"));
    const collections = [...body.matchAll(/\.collection\("(\w+)"\)/g)];
    const limit = body.match(/\.limit\(to: (\d+)\)/);
    if (collections.length === 0 || limit === null) continue;
    const order = body.match(/\.order\(by: "(\w+)"(, descending: true)?\)/);
    out.set(collections[collections.length - 1][1], {
      order: order === null ? "(none)" : `${order[1]} ${order[2] ? "desc" : "asc"}`,
      limit: Number(limit[1]),
    });
  }
  return out;
}

describe("bounded listeners", () => {
  it("ask both clients for the same documents", () => {
    const web = webBounds();
    const ios = iosBounds();
    // Anti-empty: a sweep that found nothing checked nothing.
    expect(web.size).toBeGreaterThan(3);
    const names = [...new Set([...web.keys(), ...ios.keys()])].sort();
    const problems = names.flatMap((name) => {
      const a = web.get(name);
      const b = ios.get(name);
      if (a === undefined) return [`${name}: bounded on iOS only (${b?.order}, ${b?.limit})`];
      if (b === undefined) return [`${name}: bounded on the web only (${a.order}, ${a.limit})`];
      return a.order === b.order && a.limit === b.limit
        ? []
        : [`${name}: web ${a.order} limit ${a.limit}, iOS ${b.order} limit ${b.limit}`];
    });
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
