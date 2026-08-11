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

/**
 * What the register adds up to per currency, normalised to a MONTH so that a
 * yearly insurance and a monthly subscription can sit in the same total.
 *
 * Deliberately kept apart from anything budget-shaped: this total is a summary
 * of the services screen, never a figure the household budget reads.
 */
export function monthlyTotals(
  services: readonly (DueRule & {
    amountAudCents?: number | null;
    amountUsdCents?: number | null;
  })[],
): { audCents: number; usdCents: number } {
  let audCents = 0;
  let usdCents = 0;
  for (const service of services) {
    const months = intervalMonths(service.interval);
    // Round per service, so the total is the sum of what each row would show.
    audCents += Math.round((service.amountAudCents ?? 0) / months);
    usdCents += Math.round((service.amountUsdCents ?? 0) / months);
  }
  return { audCents, usdCents };
}
