"use client";

// Firestore listener hooks. Every expense listener is BOUNDED by a date
// range, and every useEffect returns its unsubscribe (StrictMode's double
// mount would otherwise duplicate onSnapshot and burn the free tier).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  sum,
  where,
  Timestamp,
  type Firestore,
  type Query,
} from "firebase/firestore";

import { partitionCharges } from "../bank-charges";
import { getFirebaseClient } from "./client";
import { readFailed } from "./read-failures";
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


/* ── The one listener pattern ──────────────────────────────────────────── */

interface ListState<T> {
  items: T[];
  loading: boolean;
  failed?: boolean;
}

/**
 * A live, bounded list: subscribe while `buildQuery` returns a query, stay
 * empty and not loading while it returns null, and say so when the read FAILS.
 *
 * Six hooks below used to spell this out each: the same reset when the key
 * goes away, the same client check, the same "a read that failed is not a read
 * that came back empty" error branch — which is where 24 of the web's 26
 * `eslint-disable` lines came from. It is written once now, and the hooks keep
 * their own names and shapes so no screen had to change.
 *
 * Two behaviours are new by being decided once:
 * - no Firebase client (no config) resolves as not loading. Every copy used to
 *   `return` without setting state there, so a screen waited on "loading" for
 *   ever.
 * - a key change reads as empty and loading until the new snapshot arrives —
 *   a list must not present the previous key's rows as the new one's. Decided
 *   in RENDER, from which key the rows belong to: the effect that used to mark
 *   the change ran after the first render with the new key, and kept the old
 *   rows besides, so /gastos drew one range's expenses under another's name
 *   until the server answered (the e2e counted two such commits).
 *
 * `key` must change exactly when the query does; the builder is read through a
 * ref so an inline function does not resubscribe on every render.
 */
function useLiveList<T>(
  key: string | null,
  // Converters answer null for a document that does not decode; `decoded`
  // drops those (and logs them), so the list itself is of T.
  buildQuery: (db: Firestore) => Query<T | null> | null,
  label: string,
  options: { includeMetadataChanges?: boolean } = {},
  onItems?: (items: T[]) => T[],
): ListState<T> {
  // `key` records whose rows these are; see the note on key changes above.
  const [state, setState] = useState<ListState<T> & { key: string | null }>({
    key,
    items: [],
    loading: true,
  });
  const build = useRef(buildQuery);
  const post = useRef(onItems);
  useEffect(() => {
    build.current = buildQuery;
    post.current = onItems;
  });
  const metadata = options.includeMetadataChanges ?? false;

  useEffect(() => {
    const fb = key === null ? null : getFirebaseClient();
    const q = fb === null ? null : build.current(fb.db);
    if (q === null) {
      // Resetting a subscription's state as its key goes away: the listener's
      // lifetime is the external system, so there is nothing to derive in
      // render.
      setState({ key, items: [], loading: false });
      return;
    }
    return onSnapshot(
      q,
      { includeMetadataChanges: metadata },
      (snap) => {
        const items = decoded(snap.docs.map((d) => d.data()));
        setState({
          key,
          items: post.current ? post.current(items) : items,
          loading: false,
        });
      },
      // A read that FAILED is not a read that came back empty. Set as an empty
      // list, a listener error rendered as "nothing here" — for expenses, a
      // period showing its whole budget unspent.
      (error) => {
        readFailed(label, error);
        setState({ key, items: [], loading: false, failed: true });
      },
    );
  }, [key, label, metadata]);

  if (state.key !== key) return { items: [], loading: key !== null };
  return state;
}

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
 * When the Gmail ingestion last finished a run, or null when it has never
 * stamped one (an ingestion older than the heartbeat). Read once — this is
 * glanced at, not watched. See shared/schema.md, ingestStatus.
 */
export async function fetchIngestRanAt(
  db: Firestore,
  householdId: string,
): Promise<number | null> {
  const snap = await getDoc(doc(db, "households", householdId, "ingestStatus", "latest"));
  const ranAt: unknown = snap.data()?.ranAt;
  return ranAt instanceof Timestamp ? ranAt.toMillis() : null;
}

/**
 * The expenses of a range, read ONCE — for the screens somebody visits rather
 * than lives in (Datos, Estadísticas), where a listener would keep paying for
 * a range nobody is watching change.
 *
 * Both pages spelled this out, each with its own reset, loading flag and
 * failure branch. One copy now, with useLiveList's rule for a range change:
 * the rows say which range they belong to, and a mismatch reads as empty and
 * loading in render, so a new range never shows the previous one's rows.
 */
export function useExpensesOnce(
  householdId: string | null,
  startDate: string | null,
  endDate: string | null,
  label: string,
): { rows: Expense[]; loading: boolean; failed: boolean } {
  const key =
    householdId === null || startDate === null || endDate === null
      ? null
      : `${householdId}/${startDate}/${endDate}`;
  const [state, setState] = useState<{
    key: string | null;
    rows: Expense[];
    loading: boolean;
    failed: boolean;
  }>({ key: null, rows: [], loading: false, failed: false });

  useEffect(() => {
    if (key === null || householdId === null || startDate === null || endDate === null) {
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    getDocs(
      query(
        collection(fb.db, "households", householdId, "expenses"),
        where("date", ">=", startDate),
        where("date", "<=", endDate),
        orderBy("date", "asc"),
      ).withConverter(expenseConverter),
    )
      .then((snap) => {
        if (cancelled) return;
        setState({
          key,
          rows: decoded(snap.docs.map((d) => d.data())),
          loading: false,
          failed: false,
        });
      })
      // A read that failed is not a range with nothing in it.
      .catch((error: unknown) => {
        console.error(`[gastos] ${label} read`, error);
        if (!cancelled) setState({ key, rows: [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, householdId, startDate, endDate, label]);

  if (key === null) return { rows: [], loading: false, failed: false };
  if (state.key !== key) return { rows: [], loading: true, failed: false };
  return state;
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
  const key =
    householdId === null || startDate === null || endDate === null
      ? null
      : `${householdId}/${startDate}/${endDate}`;
  const { items, loading, failed } = useLiveList(
    key,
    (db) =>
      householdId === null || startDate === null || endDate === null
        ? null
        : query(
            collection(db, "households", householdId, "expenses"),
            where("date", ">=", startDate),
            where("date", "<=", endDate),
            orderBy("date", "desc"),
          ).withConverter(expenseConverter),
    "expenses",
    // So the "pending" chip clears as soon as the server acknowledges a queued
    // write. Metadata changes are local — they cost no reads.
    { includeMetadataChanges: true },
  );
  return { expenses: items, loading, failed };
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
  // Asked to delete once per mount: the snapshot fires again on our own
  // delete, and re-issuing it would be a write per round trip.
  const sweeping = useRef(new Set<string>());
  const { items, loading, failed } = useLiveList(
    householdId,
    (db) =>
      householdId === null
        ? null
        : query(
            collection(db, "households", householdId, "bankCharges"),
            // NEWEST first, so that if the cap ever bites it drops the oldest.
            // Ascending, the charge left out would have been the one that just
            // arrived. Reversed below so the rest of the app still sees
            // oldest-first, the order the matcher was built and tested on.
            orderBy("date", "desc"),
            limit(MAX_PENDING_CHARGES),
          ).withConverter(bankChargeConverter),
    "bankCharges",
    {},
    (all) => {
      const { pending, dismissed, expired } = partitionCharges(
        [...all].reverse(),
        new Date(),
      );
      const fb = getFirebaseClient();
      for (const charge of expired) {
        if (fb === null || householdId === null || sweeping.current.has(charge.id)) continue;
        sweeping.current.add(charge.id);
        // Housekeeping nobody asked for, so a refusal is logged rather than
        // put in front of anyone: the charge stays, still expired, and the
        // next session sweeps it. Uncaught, it was an unhandled rejection.
        void deleteBankCharge(fb.db, householdId, charge.id).catch((error) => {
          console.error("[gastos] sweeping an expired charge", error);
        });
      }
      return [...pending, ...dismissed];
    },
  );
  return { charges: items, loading, failed };
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
  const { items, loading, failed } = useLiveList(
    householdId,
    (db) =>
      householdId === null
        ? null
        : query(
            collection(db, "households", householdId, "services"),
            orderBy("name", "asc"),
            limit(MAX_SERVICES),
          ).withConverter(serviceConverter),
    "services",
    { includeMetadataChanges: true },
  );
  return { services: items, loading, failed };
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
  const { items, loading, failed } = useLiveList(
    householdId,
    (db) =>
      householdId === null
        ? null
        : query(
            collection(db, "households", householdId, "recurringRules"),
            orderBy("pattern", "asc"),
            limit(MAX_RECURRING_RULES),
          ).withConverter(recurringRuleConverter),
    "recurring rules",
  );
  return { rules: items, loading, failed };
}

/* ── Credit-card statements and charges ────────────────────────────────── */

/** Two years of statements — enough to page back through, bounded, and the
 * same number iOS listens to (listener-limits.test.ts). */
const MAX_STATEMENTS = 24;

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
  const { items, loading, failed } = useLiveList(
    householdId,
    (db) =>
      householdId === null
        ? null
        : query(
            collection(db, "households", householdId, "cardStatements"),
            orderBy("closingDate", "desc"),
            limit(MAX_STATEMENTS),
          ).withConverter(cardStatementConverter),
    "cardStatements",
  );
  return { statements: items, loading, failed };
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
  const key =
    householdId === null || startDate === null || closingDate === null
      ? null
      : `${householdId}/${startDate}/${closingDate}`;
  const { items, loading, failed } = useLiveList(
    key,
    (db) =>
      householdId === null || startDate === null || closingDate === null
        ? null
        : query(
            collection(db, "households", householdId, "cardCharges"),
            where("date", ">=", startDate),
            where("date", "<=", closingDate),
            orderBy("date", "desc"),
          ).withConverter(cardChargeConverter),
    "cardCharges",
    { includeMetadataChanges: true },
  );
  return { charges: items, loading, failed };
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
 * Spend for a calendar month (1 server-side read). Separate from the period
 * totals because a month rarely lines up with a weekly/fortnightly period — it
 * answers "how are we going this month" regardless of where the period
 * boundaries fall.
 *
 * NOT served from the session cache, and asked again whenever `refreshKey`
 * changes. It used to be cached for the whole session, so an expense added in
 * Gastos was missing from Inicio's month until a reload — on the screen that
 * exists to be glanced at after spending. `refreshKey` is the caller's
 * `ledgerSignature` of the period under way: one read per change to the
 * ledger, which for two people is a handful a day. Changes the current
 * period's listener cannot see (an older expense of the same month edited on
 * the other phone) are picked up the next time Inicio mounts.
 *
 * `refreshKey` null means the ledger is still loading: nothing is asked until
 * it is known, so opening Inicio costs one read rather than two.
 */
export function useMonthTotal(
  householdId: string | null,
  /** Any date inside the month, "YYYY-MM-DD" in the household timezone. */
  today: string | null,
  categoryIds: string[] | null = null,
  refreshKey: string | null = "",
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

  // Which month the figure on screen belongs to. A refresh of the SAME month
  // keeps showing the previous figure until the new one arrives, rather than
  // flashing "Cargando…" every time an expense is added.
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (householdId === null || range === null) {
      // This effect owns a one-shot aggregation; clearing before it starts is
      // part of that request's lifecycle, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTotal(null);
      setStatus("loading");
      shownFor.current = null;
      return;
    }
    if (refreshKey === null) return;
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    const monthKey = `${householdId}/${range.startDate}/${serializedCategories}`;
    if (shownFor.current !== monthKey) {
      setTotal(null);
      setStatus("loading");
    }
    void fetchPeriodTotal(
      fb.db,
      householdId,
      range,
      serializedCategories === "" ? null : serializedCategories.split("+"),
      true,
    )
      .then((value) => {
        if (cancelled) return;
        shownFor.current = monthKey;
        setTotal(value);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        shownFor.current = null;
        setTotal(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, range, serializedCategories, refreshKey]);

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
