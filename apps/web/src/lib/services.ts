// Recurring bills — the "Servicios" register.
//
// The one piece of real logic here is WHEN a service falls due. A stored date
// would be wrong the moment the month turned, so a service stores a rule
// (`dueDay` + `interval`, plus `anchorMonth` for anything less frequent than
// monthly) and the date is derived from today. That way nobody has to maintain
// it and both members always see the same answer.
//
// Pure module: no Firebase, no React. Dates are the same zero-padded
// "YYYY-MM-DD" calendar strings the rest of the app uses, computed against a
// `today` the caller resolves in the HOUSEHOLD timezone.

export type ServiceInterval =
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "biannual"
  | "yearly";

export type PaidWith = "debit" | "credit";

export const SERVICE_INTERVALS: readonly ServiceInterval[] = [
  "monthly",
  "bimonthly",
  "quarterly",
  "biannual",
  "yearly",
] as const;

/** The shape the due-date maths needs; the Firestore doc carries more. */
export interface DueRule {
  interval: ServiceInterval;
  /** 1..31. Clamped down in months that are shorter than it. */
  dueDay: number;
  /** 1..12 — which month the cycle lands on. Null/absent when monthly. */
  anchorMonth?: number | null;
}

/** How many months apart two consecutive due dates are. */
export function intervalMonths(interval: ServiceInterval): number {
  switch (interval) {
    case "monthly":
      return 1;
    case "bimonthly":
      return 2;
    case "quarterly":
      return 3;
    case "biannual":
      return 6;
    case "yearly":
      return 12;
  }
}

/** Days in a 1-based (year, month) — day 0 of the next month is this one's last. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `YYYY-MM-DD` for a (year, month, day), with the day clamped to the month's
 * length. A bill due "on the 31st" is due on the 28th of February — moving it
 * into March instead would report the wrong month entirely.
 */
function clampedDate(year: number, month: number, day: number): string {
  const clamped = Math.min(day, daysInMonth(year, month));
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${clamped.toString().padStart(2, "0")}`;
}

/** Whether a 1-based month is one this rule falls due in. */
function isDueMonth(rule: DueRule, month: number): boolean {
  const step = intervalMonths(rule.interval);
  if (step === 1) return true;
  const anchor = rule.anchorMonth ?? 1;
  return (((month - anchor) % step) + step) % step === 0;
}

/**
 * The first due date on or after `today`. "On" matters: a bill due today is due
 * today, not next month.
 *
 * Walks forward month by month rather than doing modular arithmetic in one shot,
 * because the clamping makes the answer depend on each candidate month's length.
 * At most `step + 1` iterations: if this month is a due month whose day has
 * already passed, the next one is exactly `step` months away.
 */
export function nextDueDate(rule: DueRule, today: string): string {
  const step = intervalMonths(rule.interval);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));

  for (let i = 0; i <= step; i += 1) {
    if (isDueMonth(rule, month)) {
      const candidate = clampedDate(year, month, rule.dueDay);
      if (candidate >= today) return candidate;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  // Unreachable: a due month always occurs within one full cycle.
  return clampedDate(year, month, rule.dueDay);
}

/** Whole days from `today` to the next due date. 0 means "due today". */
export function daysUntilDue(rule: DueRule, today: string): number {
  const due = nextDueDate(rule, today);
  const toUtc = (date: string): number =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    );
  return Math.round((toUtc(due) - toUtc(today)) / 86_400_000);
}

/**
 * Sort key for the list: soonest due first, ties broken by name so the order
 * never flickers between renders.
 */
export function compareByDueDate<T extends DueRule & { name: string }>(
  today: string,
): (a: T, b: T) => number {
  return (a, b) => {
    const byDate = nextDueDate(a, today).localeCompare(nextDueDate(b, today));
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
  };
}

/** The category an expense must be in to count as paying a service. */
export const SERVICES_CATEGORY_ID = "services";

/** Whether this rule falls due in a given 1-based month. */
export function isDueInMonth(rule: DueRule, month: number): boolean {
  return isDueMonth(rule, month);
}

/**
 * Case- and accent-insensitive comparison key for a name.
 *
 * The link between a service and the expense that paid it is the NAME, because
 * that is the only thing a person types twice. "Telefonía" and "telefonia" are
 * the same bill.
 */
export function nameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export interface ServiceLike extends DueRule {
  id: string;
  name: string;
  amountAudCents?: number | null;
  amountUsdCents?: number | null;
}

export interface ChargeLike {
  id: string;
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  usdCents?: number | null;
}

export interface ServiceStatus {
  /** Falls due in the month being looked at. */
  dueThisMonth: boolean;
  /** The expense that paid it this month, when there is one. */
  charge: ChargeLike | null;
  /**
   * The expense disagrees with the amount on file. Null when there is nothing
   * to compare — no charge yet, or a service quoted only in USD, which an AUD
   * expense cannot contradict.
   */
  differenceCents: number | null;
}

/**
 * Which service each of this month's service expenses paid, and whether the
 * amount on file still matches what was actually charged.
 *
 * The link is by NAME within the Servicios category: an expense filed there
 * whose note matches a service's name is that service's charge for the month.
 * Nothing is stored on either document — a link that lived in the data would
 * have to be repaired every time somebody renamed a service or fixed a typo,
 * and this one simply follows.
 *
 * `expenses` must already be limited to the month in question; this does not
 * filter by date, so the caller decides which month "this month" is.
 */
export function serviceStatuses(
  services: readonly ServiceLike[],
  expenses: readonly ChargeLike[],
  month: number,
): Map<string, ServiceStatus> {
  const charges = new Map<string, ChargeLike>();
  for (const expense of expenses) {
    if (expense.categoryId !== SERVICES_CATEGORY_ID) continue;
    const key = nameKey(expense.note);
    if (key === "") continue;
    // First one wins, by date then id, so two charges for the same service in
    // one month give a stable answer rather than whichever arrived last.
    const previous = charges.get(key);
    if (
      previous === undefined ||
      expense.date < previous.date ||
      (expense.date === previous.date && expense.id < previous.id)
    ) {
      charges.set(key, expense);
    }
  }

  const out = new Map<string, ServiceStatus>();
  for (const service of services) {
    const charge = charges.get(nameKey(service.name)) ?? null;
    const expected = service.amountAudCents ?? null;
    out.set(service.id, {
      dueThisMonth: isDueMonth(service, month),
      charge,
      differenceCents:
        charge === null || expected === null
          ? null
          : charge.amountCents - expected,
    });
  }
  return out;
}

export interface MonthTotals {
  /** What the month's services will cost, whether or not they have landed. */
  dueAudCents: number;
  dueUsdCents: number;
  /** What has actually been charged so far, from the expenses. */
  chargedAudCents: number;
  chargedUsdCents: number;
  /** How many of the month's services have been charged, out of how many. */
  chargedCount: number;
  dueCount: number;
}

/**
 * The two figures the screen leads with: what this month costs, and how much of
 * it has already been charged.
 *
 * Replaces a "per month" average that normalised a yearly bill to a twelfth of
 * itself. That number was arithmetically fine and answered a question nobody
 * asks — it could not be reconciled against any month's actual charges, which
 * is the only thing this screen is for.
 *
 * The due side counts the amount ON FILE for services that fall due; the
 * charged side counts what the expenses say, so a bill that came in higher
 * makes the two disagree on purpose.
 */
export function monthTotals(
  services: readonly ServiceLike[],
  statuses: Map<string, ServiceStatus>,
): MonthTotals {
  const totals: MonthTotals = {
    dueAudCents: 0,
    dueUsdCents: 0,
    chargedAudCents: 0,
    chargedUsdCents: 0,
    chargedCount: 0,
    dueCount: 0,
  };
  for (const service of services) {
    const status = statuses.get(service.id);
    if (status === undefined || !status.dueThisMonth) continue;
    totals.dueCount += 1;
    totals.dueAudCents += service.amountAudCents ?? 0;
    totals.dueUsdCents += service.amountUsdCents ?? 0;
    if (status.charge !== null) {
      totals.chargedCount += 1;
      totals.chargedAudCents += status.charge.amountCents;
      totals.chargedUsdCents += status.charge.usdCents ?? 0;
    }
  }
  return totals;
}
