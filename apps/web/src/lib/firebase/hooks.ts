"use client";

// Firestore listener hooks. Every expense listener is BOUNDED by a date
// range, and every useEffect returns its unsubscribe (StrictMode's double
// mount would otherwise duplicate onSnapshot and burn the free tier).

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getAggregateFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  sum,
  where,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseClient } from "./client";
import {
  bankChargeConverter,
  expenseConverter,
  type BankChargeDoc,
  type Expense,
} from "./converters";
import type { PeriodRange } from "../periods";

export interface ExpensesState {
  expenses: Expense[];
  loading: boolean;
}

/**
 * Live expenses for a household within [startDate, endDate] (inclusive,
 * lexicographic on the zero-padded date strings).
 */
export function useExpensesRange(
  householdId: string | null,
  startDate: string | null,
  endDate: string | null,
): ExpensesState {
  const [state, setState] = useState<ExpensesState>({
    expenses: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null || startDate === null || endDate === null) {
      setState({ expenses: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(
      collection(fb.db, "households", householdId, "expenses"),
      where("date", ">=", startDate),
      where("date", "<=", endDate),
      orderBy("date", "desc"),
    ).withConverter(expenseConverter);
    const unsubscribe = onSnapshot(
      q,
      // includeMetadataChanges so the "pending" chip clears as soon as the
      // server acknowledges a queued write. Metadata changes are local — they
      // don't cost reads.
      { includeMetadataChanges: true },
      (snap) => {
        setState({ expenses: snap.docs.map((d) => d.data()), loading: false });
      },
      () => setState({ expenses: [], loading: false }),
    );
    return unsubscribe;
  }, [householdId, startDate, endDate]);

  return state;
}

/* ── Bank charges waiting to be matched ────────────────────────────────── */

/** How many pending charges to listen to. A charge leaves the collection as
 * soon as it is matched or discarded, so the pending set is small by
 * construction; the cap is a backstop, not a feature. */
const MAX_PENDING_CHARGES = 50;

export interface BankChargesState {
  charges: BankChargeDoc[];
  loading: boolean;
}

/**
 * Live pending bank charges, oldest first (the ones that have been waiting
 * longest are the ones to deal with). Bounded by `limit`, like every other
 * listener in the app.
 */
export function useBankCharges(householdId: string | null): BankChargesState {
  const [state, setState] = useState<BankChargesState>({
    charges: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null) {
      setState({ charges: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const q = query(
      collection(fb.db, "households", householdId, "bankCharges"),
      orderBy("date", "asc"),
      limit(MAX_PENDING_CHARGES),
    ).withConverter(bankChargeConverter);
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({ charges: snap.docs.map((d) => d.data()), loading: false });
      },
      () => setState({ charges: [], loading: false }),
    );
    return unsubscribe;
  }, [householdId]);

  return state;
}

/* ── Past-period totals via server-side aggregation ────────────────────── */

// Session cache: one sum() aggregation (1 read) per past period, keyed by
// householdId/periodStart. Module-level on purpose — it survives route
// changes but resets on a full reload. NOT persisted to localStorage: past
// periods are editable, so a durable cache could go stale forever. Storing
// the in-flight promise also dedupes StrictMode's double mount.
const periodTotalsCache = new Map<string, Promise<number>>();

function totalCacheKey(
  householdId: string,
  range: PeriodRange,
  categoryIds: string[] | null = null,
): string {
  // BOTH ends of the range belong in the key. Keying on the start alone made a
  // fortnight beginning on the 1st share an entry with that whole month, so
  // whichever asked first answered for the other — the month card showing a
  // fortnight's spending, or the trend bar showing a month's.
  // The filter is part of the identity too: excluding a category must not read
  // a total that was computed while it still counted.
  const scope = categoryIds === null ? "all" : [...categoryIds].sort().join("+");
  return `${householdId}/${range.startDate}_${range.endDate}/${scope}`;
}

/** Seed the cache from live listener data (e.g. while a past period is
 * open its docs are already on the client — no aggregation read needed). */
/** Seeds the cache for a period whose docs are already on the client.
 * `categoryIds` must match what the reader will ask for. */
export function primePeriodTotal(
  householdId: string,
  range: PeriodRange,
  totalCents: number,
  categoryIds: string[] | null = null,
): void {
  // Never prime a zero: a listener that hasn't delivered yet is indistinguishable
  // from a period with no spending, and caching that zero poisons every later
  // reader (it once made a period carry over its FULL budget as "leftover").
  // A genuinely empty period just costs one cheap aggregation instead.
  if (totalCents <= 0) return;
  periodTotalsCache.set(
    totalCacheKey(householdId, range, categoryIds),
    Promise.resolve(totalCents),
  );
}

/**
 * Spend for a calendar month (1 server-side read, cached like the period
 * totals). Separate from the period totals because a month rarely lines up
 * with a weekly/fortnightly period — it answers "how are we going this month"
 * regardless of where the period boundaries fall.
 */
export function useMonthTotal(
  householdId: string | null,
  /** Any date inside the month, "YYYY-MM-DD" in the household timezone. */
  today: string | null,
  categoryIds: string[] | null = null,
): {
  total: number | null;
  status: "loading" | "ready" | "error";
  range: PeriodRange | null;
} {
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const range = useMemo<PeriodRange | null>(() => {
    if (today === null) return null;
    const [year, month] = today.split("-");
    const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    return {
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(last).padStart(2, "0")}`,
    };
  }, [today]);
  const serializedCategories = useMemo(
    () => (categoryIds === null ? "" : [...categoryIds].sort().join("+")),
    [categoryIds],
  );

  useEffect(() => {
    if (householdId === null || range === null) {
      setTotal(null);
      setStatus("loading");
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    setStatus("loading");
    void fetchPeriodTotal(
      fb.db,
      householdId,
      range,
      serializedCategories === "" ? null : serializedCategories.split("+"),
    )
      .then((value) => {
        if (cancelled) return;
        setTotal(value);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setTotal(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, range, serializedCategories]);

  return { total, status, range };
}

/** Server-side spend total for a range (1 read, cached for the session).
 * Exported for period materialization, which needs the previous period's
 * spend to work out what to carry over. */
export function fetchPeriodSpent(
  db: Firestore,
  householdId: string,
  range: PeriodRange,
  categoryIds: string[] | null,
): Promise<number> {
  // Deliberately bypasses the cache. This figure decides real money — how much
  // budget the next period starts with — and the cache can legitimately hold a
  // value primed from a listener that hadn't delivered yet. One extra read,
  // once per period, is the right price for not carrying over a wrong number.
  return fetchPeriodTotal(db, householdId, range, categoryIds, true);
}

function fetchPeriodTotal(
  db: Firestore,
  householdId: string,
  range: PeriodRange,
  /** null ⇒ every category counts, so no filter is needed (and no composite
   * index either). Otherwise the ids that count, at most 30 — the same cap the
   * rules put on the categories map, which is also Firestore's `in` limit. */
  categoryIds: string[] | null,
  /** Skip the cached value (still refreshes it) — see fetchPeriodSpent. */
  bypassCache = false,
): Promise<number> {
  const key = totalCacheKey(householdId, range, categoryIds);
  const cached = periodTotalsCache.get(key);
  if (cached !== undefined && !bypassCache) return cached;
  // Nothing counts towards the budget — no query to run.
  if (categoryIds !== null && categoryIds.length === 0) {
    return Promise.resolve(0);
  }
  const constraints = [
    where("date", ">=", range.startDate),
    where("date", "<=", range.endDate),
    ...(categoryIds !== null ? [where("categoryId", "in", categoryIds)] : []),
  ];
  const promise = getAggregateFromServer(
    query(collection(db, "households", householdId, "expenses"), ...constraints),
    { total: sum("amountCents") },
  ).then((snap) => snap.data().total ?? 0);
  periodTotalsCache.set(key, promise);
  // Don't cache failures — the next render retries.
  promise.catch(() => periodTotalsCache.delete(key));
  return promise;
}

/**
 * Spent totals (integer cents) for PAST periods, keyed by startDate. One
 * aggregation query per period (1 Firestore read each) instead of streaming
 * every expense doc; results are cached for the session. The CURRENT period
 * must keep its live listener — never pass it here.
 */
export function usePastPeriodTotals(
  householdId: string | null,
  periods: PeriodRange[],
  /** Categories that count towards the budget; null ⇒ all of them. */
  categoryIds: string[] | null = null,
): Record<string, number> {
  const [totals, setTotals] = useState<Record<string, number>>({});
  // Serialize so the effect keys on VALUES (the array identity changes
  // every render).
  const serialized = useMemo(
    () => periods.map((p) => `${p.startDate}_${p.endDate}`).join(","),
    [periods],
  );
  // Same reason as above: key the effect on the VALUES of the filter.
  const serializedCategories = useMemo(
    () => (categoryIds === null ? "" : [...categoryIds].sort().join("+")),
    [categoryIds],
  );

  useEffect(() => {
    if (householdId === null || serialized === "") {
      setTotals({});
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const ranges: PeriodRange[] = serialized.split(",").map((pair) => {
      const [startDate, endDate] = pair.split("_");
      return { startDate, endDate };
    });
    let cancelled = false;
    void Promise.all(
      ranges.map(async (range) => {
        try {
          return [
            range.startDate,
            await fetchPeriodTotal(
              fb.db,
              householdId,
              range,
              serializedCategories === "" ? null : serializedCategories.split("+"),
            ),
          ] as const;
        } catch {
          return null; // offline / rules error — omit rather than lie with 0
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setTotals(
        Object.fromEntries(entries.filter((e) => e !== null)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [householdId, serialized, serializedCategories]);

  return totals;
}
