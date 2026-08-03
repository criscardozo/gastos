"use client";

// Firestore listener hooks. Every expense listener is BOUNDED by a date
// range, and every useEffect returns its unsubscribe (StrictMode's double
// mount would otherwise duplicate onSnapshot and burn the free tier).

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getAggregateFromServer,
  onSnapshot,
  orderBy,
  query,
  sum,
  where,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseClient } from "./client";
import { expenseConverter, type Expense } from "./converters";
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

/* ── Past-period totals via server-side aggregation ────────────────────── */

// Session cache: one sum() aggregation (1 read) per past period, keyed by
// householdId/periodStart. Module-level on purpose — it survives route
// changes but resets on a full reload. NOT persisted to localStorage: past
// periods are editable, so a durable cache could go stale forever. Storing
// the in-flight promise also dedupes StrictMode's double mount.
const periodTotalsCache = new Map<string, Promise<number>>();

function totalCacheKey(
  householdId: string,
  startDate: string,
  categoryIds: string[] | null = null,
): string {
  // The filter is part of the identity: excluding a category must not read a
  // total that was computed while it still counted.
  const scope = categoryIds === null ? "all" : [...categoryIds].sort().join("+");
  return `${householdId}/${startDate}/${scope}`;
}

/** Seed the cache from live listener data (e.g. while a past period is
 * open its docs are already on the client — no aggregation read needed). */
/** Seeds the cache for a period whose docs are already on the client.
 * `categoryIds` must match what the reader will ask for. */
export function primePeriodTotal(
  householdId: string,
  startDate: string,
  totalCents: number,
  categoryIds: string[] | null = null,
): void {
  periodTotalsCache.set(
    totalCacheKey(householdId, startDate, categoryIds),
    Promise.resolve(totalCents),
  );
}

function fetchPeriodTotal(
  db: Firestore,
  householdId: string,
  range: PeriodRange,
  /** null ⇒ every category counts, so no filter is needed (and no composite
   * index either). Otherwise the ids that count, at most 30 — the same cap the
   * rules put on the categories map, which is also Firestore's `in` limit. */
  categoryIds: string[] | null,
): Promise<number> {
  const key = totalCacheKey(householdId, range.startDate, categoryIds);
  const cached = periodTotalsCache.get(key);
  if (cached !== undefined) return cached;
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
