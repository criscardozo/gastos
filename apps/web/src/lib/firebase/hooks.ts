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

import { partitionCharges } from "../bank-charges";
import { getFirebaseClient } from "./client";
import { deleteBankCharge } from "./mutations";
import {
  bankChargeConverter,
  cardChargeConverter,
  cardStatementConverter,
  expenseConverter,
  recurringRuleConverter,
  serviceConverter,
  type BankChargeDoc,
  type CardCharge,
  type CardStatement,
  type Expense,
  type RecurringRuleDoc,
  type ServiceDoc,
} from "./converters";
import { decoded } from "./shape";
import type { PeriodRange } from "../periods";

export interface ExpensesState {
  expenses: Expense[];
  loading: boolean;
  /**
   * The listener errored. Distinct from an empty result: the screen must say it
   * could not read rather than draw a zero. Reads DO fail offline, unlike
   * writes, which Firestore queues instead.
   */
  failed?: boolean;
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
      // resetting a subscription's state as its range changes. The listener's
      // lifetime is the external system; nothing here can be derived in
      // render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        setState({
          expenses: decoded(snap.docs.map((d) => d.data())),
          loading: false,
        });
      },
      // A read that FAILED is not a read that came back empty. This used to
      // set an empty list either way, so a listener error rendered as "nothing
      // here" — indistinguishable from the real thing, and for expenses that
      // means a period showing its whole budget unspent.
      (error) => {
        console.error("[gastos] expenses listener", error);
        setState({ expenses: [], loading: false, failed: true });
      },
    );
    return unsubscribe;
  }, [householdId, startDate, endDate]);

  return state;
}

/* ── Bank charges waiting to be matched ────────────────────────────────── */

/** How many charges to listen to. A charge leaves the collection as soon as it
 * is matched, and a dismissed one within 48 hours, so the set is small by
 * construction; the cap is a backstop, not a feature. */
const MAX_PENDING_CHARGES = 50;

export interface BankChargesState {
  /** Pending AND recoverable — the callers split them with partitionCharges.
   * Anything past the window is filtered out here and swept. */
  charges: BankChargeDoc[];
  loading: boolean;
  /**
   * The listener errored. Distinct from an empty result: the screen must say it
   * could not read rather than draw a zero. Reads DO fail offline, unlike
   * writes, which Firestore queues instead.
   */
  failed?: boolean;
}

/**
 * Live bank charges, oldest first (the ones that have been waiting longest are
 * the ones to deal with). Bounded by `limit`, like every other listener.
 *
 * This is also where expired dismissals get deleted. Without Cloud Functions
 * there is nothing server-side to do it, so the client that opens the screen
 * does — which makes the 48 hours a display window rather than a retention
 * guarantee: nothing here is load-bearing, since every reader already hides
 * whatever it would have deleted.
 */
export function useBankCharges(householdId: string | null): BankChargesState {
  const [state, setState] = useState<BankChargesState>({
    charges: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null) {
      // Resetting a subscription's state as its key changes. The listener's
      // lifetime is the external system here; there is nothing to derive from
      // in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ charges: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const q = query(
      collection(fb.db, "households", householdId, "bankCharges"),
      // NEWEST first, so that if the cap ever bites it drops the oldest.
      // Ascending, the charge left out would have been the one that just
      // arrived. Reversed below so the rest of the app still sees oldest-first,
      // the order the matcher was built and tested on.
      orderBy("date", "desc"),
      limit(MAX_PENDING_CHARGES),
    ).withConverter(bankChargeConverter);
    // Asked to delete once per mount: the snapshot fires again on our own
    // delete, and re-issuing it would be a write per round trip.
    const sweeping = new Set<string>();
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const all = decoded(snap.docs.map((d) => d.data())).reverse();
        const { pending, dismissed, expired } = partitionCharges(all, new Date());
        setState({ charges: [...pending, ...dismissed], loading: false });
        for (const charge of expired) {
          if (sweeping.has(charge.id)) continue;
          sweeping.add(charge.id);
          void deleteBankCharge(fb.db, householdId, charge.id);
        }
      },
      // A read that FAILED is not a read that came back empty. This used to
      // set an empty list either way, so a listener error rendered as "nothing
      // here" — indistinguishable from the real thing, and for expenses that
      // means a period showing its whole budget unspent.
      (error) => {
        console.error("[gastos] bankCharges listener", error);
        setState({ charges: [], loading: false, failed: true });
      },
    );
    return unsubscribe;
  }, [householdId]);

  return state;
}

/* ── Services ──────────────────────────────────────────────────────────── */

/** A household pays for a handful of things, not hundreds. A cap, not a page. */
const MAX_SERVICES = 60;

export interface ServicesState {
  services: ServiceDoc[];
  loading: boolean;
  /**
   * The listener errored. Distinct from an empty result: the screen must say it
   * could not read rather than draw a zero. Reads DO fail offline, unlike
   * writes, which Firestore queues instead.
   */
  failed?: boolean;
}

/**
 * Live services. There is no date to bound this listener by, so the cap plays
 * that role: the collection cannot grow without someone adding rows by hand.
 */
export function useServices(householdId: string | null): ServicesState {
  const [state, setState] = useState<ServicesState>({
    services: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null) {
      // Resetting a subscription's state as its key changes. The listener's
      // lifetime is the external system here; there is nothing to derive from
      // in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ services: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const q = query(
      collection(fb.db, "households", householdId, "services"),
      orderBy("name", "asc"),
      limit(MAX_SERVICES),
    ).withConverter(serviceConverter);
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setState({
          services: decoded(snap.docs.map((d) => d.data())),
          loading: false,
        });
      },
      // A read that FAILED is not a read that came back empty. This used to
      // set an empty list either way, so a listener error rendered as "nothing
      // here" — indistinguishable from the real thing, and for expenses that
      // means a period showing its whole budget unspent.
      (error) => {
        console.error("[gastos] services listener", error);
        setState({ services: [], loading: false, failed: true });
      },
    );
  }, [householdId]);

  return state;
}

/* ── Recurring rules ───────────────────────────────────────────────────── */

/**
 * Enough patterns for a household that files by hand anyway, and bounded like
 * every other listener because the free tier is part of the design.
 */
const MAX_RECURRING_RULES = 50;

export interface RecurringRulesState {
  rules: RecurringRuleDoc[];
  loading: boolean;
  /**
   * The listener errored. It matters more here than elsewhere: read as an
   * empty list, a failed read means NO rule matches, so charges quietly stop
   * being filed and nothing says why.
   */
  failed?: boolean;
}

export function useRecurringRules(
  householdId: string | null,
): RecurringRulesState {
  const [state, setState] = useState<RecurringRulesState>({
    rules: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ rules: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const q = query(
      collection(fb.db, "households", householdId, "recurringRules"),
      orderBy("pattern", "asc"),
      limit(MAX_RECURRING_RULES),
    ).withConverter(recurringRuleConverter);
    return onSnapshot(
      q,
      (snap) => {
        setState({ rules: decoded(snap.docs.map((d) => d.data())), loading: false });
      },
      (error) => {
        console.error("[gastos] recurring rules listener", error);
        setState({ rules: [], loading: false, failed: true });
      },
    );
  }, [householdId]);

  return state;
}

/* ── Credit-card statements and charges ────────────────────────────────── */

/** Roughly a year of statements — enough to page back through, bounded. */
const MAX_STATEMENTS = 13;

export interface StatementsState {
  statements: CardStatement[];
  loading: boolean;
  /**
   * The listener errored. Distinct from an empty result: the screen must say it
   * could not read rather than draw a zero. Reads DO fail offline, unlike
   * writes, which Firestore queues instead.
   */
  failed?: boolean;
}

/** Statements, newest closing date first. */
export function useCardStatements(householdId: string | null): StatementsState {
  const [state, setState] = useState<StatementsState>({
    statements: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null) {
      // Resetting a subscription's state as its key changes. The listener's
      // lifetime is the external system here; there is nothing to derive from
      // in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ statements: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    const q = query(
      collection(fb.db, "households", householdId, "cardStatements"),
      orderBy("closingDate", "desc"),
      limit(MAX_STATEMENTS),
    ).withConverter(cardStatementConverter);
    return onSnapshot(
      q,
      (snap) => {
        setState({
          statements: decoded(snap.docs.map((d) => d.data())),
          loading: false,
        });
      },
      // A read that FAILED is not a read that came back empty. This used to
      // set an empty list either way, so a listener error rendered as "nothing
      // here" — indistinguishable from the real thing, and for expenses that
      // means a period showing its whole budget unspent.
      (error) => {
        console.error("[gastos] cardStatements listener", error);
        setState({ statements: [], loading: false, failed: true });
      },
    );
  }, [householdId]);

  return state;
}

export interface CardChargesState {
  charges: CardCharge[];
  loading: boolean;
  /**
   * The listener errored. Distinct from an empty result: the screen must say it
   * could not read rather than draw a zero. Reads DO fail offline, unlike
   * writes, which Firestore queues instead.
   */
  failed?: boolean;
}

/**
 * Live card charges within a statement's [startDate, closingDate] — the same
 * bounded, lexicographic date range every expense listener uses.
 */
export function useCardCharges(
  householdId: string | null,
  startDate: string | null,
  closingDate: string | null,
): CardChargesState {
  const [state, setState] = useState<CardChargesState>({
    charges: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null || startDate === null || closingDate === null) {
      // Resetting a subscription's state as its key changes. The listener's
      // lifetime is the external system here; there is nothing to derive from
      // in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ charges: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(
      collection(fb.db, "households", householdId, "cardCharges"),
      where("date", ">=", startDate),
      where("date", "<=", closingDate),
      orderBy("date", "desc"),
    ).withConverter(cardChargeConverter);
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setState({
          charges: decoded(snap.docs.map((d) => d.data())),
          loading: false,
        });
      },
      // A read that FAILED is not a read that came back empty. This used to
      // set an empty list either way, so a listener error rendered as "nothing
      // here" — indistinguishable from the real thing, and for expenses that
      // means a period showing its whole budget unspent.
      (error) => {
        console.error("[gastos] cardCharges listener", error);
        setState({ charges: [], loading: false, failed: true });
      },
    );
  }, [householdId, startDate, closingDate]);

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
      // This effect owns a one-shot aggregation; clearing before it starts is
      // part of that request's lifecycle, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // This effect owns a one-shot aggregation; clearing before it starts is
      // part of that request's lifecycle, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
