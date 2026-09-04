// Typed Firestore converters per shared/schema.md. Money is integer cents.
// Writes go through mutations.ts with explicit field sets (the rules demand
// exact shapes + serverTimestamp()); converters are for typed reads.

import {
  QueryDocumentSnapshot,
  type DocumentData,
  type FirestoreDataConverter,
  type Timestamp,
} from "firebase/firestore";

import type { CategoryDef } from "../categories";
import type { PeriodType } from "../periods";
import type { HouseholdCards } from "../cards";
// SERVICE_INTERVALS rather than a list spelled out again below: the first
// attempt at that wrote "annual" where the type says "yearly", and every
// yearly service would have silently decoded as monthly.
import {
  SERVICE_INTERVALS,
  type PaidWith,
  type ServiceInterval,
} from "../services";
import type { CardBrand } from "../statements";
import {
  isCalendarDate,
  isInt,
  isMaybeEmptyString,
  isObject,
  isOneOf,
  isPositiveInt,
  isString,
  isStringArray,
  rejectDoc,
} from "./shape";

export interface UserDoc {
  uid: string;
  displayName: string;
  householdId: string | null;
  language: "es" | "en" | null;
}

export interface MemberProfile {
  displayName: string;
  color: string;
}

export interface DefaultBudget {
  amountCents: number;
  period: PeriodType;
  anchorDate: string;
  /** Carry the previous period's leftover into the next one. Absent ⇒ off. */
  rollover?: boolean;
}

export interface Household {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  defaultBudget: DefaultBudget;
  memberIds: string[];
  memberProfiles: Record<string, MemberProfile>;
  categories: Record<string, CategoryDef>;
  /** Keyed by the card's last four digits — the only identifier the bank gives.
   * Empty until configured, which reads as "route nothing, show everything". */
  cards: HouseholdCards;
  /** The ARS side of a card statement. Absent fields ⇒ nothing configured. */
  cardFees: CardFeeSettings;
}

export interface CardFeeSettings {
  /** The bank's fixed monthly account fee, in ARS cents. 0 ⇒ not configured,
   * which hides the fee lines rather than showing them as zero. */
  commissionArsCents: number;
  /** Fallback peso-per-dollar rate for when the quote service is unreachable.
   * null ⇒ no estimate at all, which is better than one at a made-up rate. */
  usdArsRate: number | null;
}

export interface PeriodBudget {
  startDate: string;
  endDate: string;
  period: PeriodType;
  /** The EFFECTIVE budget — carried-over leftover already included. */
  amountCents: number;
  source: "default" | "custom";
  /** How much of `amountCents` came from the previous period. Signed: an
   * overspent period carries its deficit forward. Display only. */
  rolloverCents: number;
  /**
   * Somebody in the household answered the start-period sheet for this period.
   * false means nobody has — not "this device has not seen it", which is what
   * the old per-device key meant and why confirming on the phone left the web
   * asking again.
   */
  confirmed: boolean;
}

export interface Expense {
  id: string;
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  createdBy: string;
  /** What the BANK charged in USD (integer cents), null until it is known.
   * Never a conversion of `amountCents` and never summed. */
  usdCents: number | null;
  /** Whether `usdCents` is known. Stored, but absent on expenses created
   * before the field ⇒ false. */
  verified: boolean;
  createdAt: Timestamp | null;
  /** Last write to the doc — shown in the detail when it differs from the
   * creation, so an edited expense says so. */
  updatedAt: Timestamp | null;
  /** Written locally but not yet acknowledged by the server — the expense is
   * queued offline. Local state, never a stored field. */
  pendingWrite: boolean;
}

/** `households/{id}/bankCharges/{gmailMessageId}` — see shared/schema.md. */
export interface BankChargeDoc {
  id: string;
  usdCents: number;
  date: string;
  merchant: string;
  cardLast4: string | null;
  /** When a member discarded it; null while pending. Recoverable for
   * DISMISS_WINDOW_HOURS after this — see lib/bank-charges.ts. */
  dismissedAt: Date | null;
}

/** `households/{id}/services/{id}` — a recurring bill. See shared/schema.md. */
export interface ServiceDoc {
  id: string;
  name: string;
  /** Integer cents. Null when the bill is only quoted in the other currency. */
  amountAudCents: number | null;
  /** Integer cents of USD — typed by the user, NOT converted from the AUD one. */
  amountUsdCents: number | null;
  interval: ServiceInterval;
  dueDay: number;
  /** Which month the cycle lands on; null when monthly (nothing to anchor). */
  anchorMonth: number | null;
  paidWith: PaidWith;
  createdBy: string;
  pendingWrite: boolean;
}

/** `households/{id}/cardStatements/{closingDate}`. */
export interface CardStatement {
  startDate: string;
  /** Also the doc id. */
  closingDate: string;
  dueDate: string;
}

/** `households/{id}/cardCharges/{id}` — always USD. */
export interface CardCharge {
  id: string;
  date: string;
  detail: string;
  card: CardBrand;
  usdCents: number;
  /** A digital service from abroad, which the bank taxes twice more. Absent on
   * the doc reads as TRUE — see shared/schema.md. */
  digital: boolean;
  /** Somebody checked this line against the paper statement. Absent ⇒ FALSE:
   * the opposite default to `digital`, because nobody checked it. */
  verified: boolean;
  createdBy: string;
  pendingWrite: boolean;
}

export interface Invite {
  code: string;
  householdId: string;
  createdBy: string;
}

/**
 * A read-only converter that is allowed to say no.
 *
 * `fromFirestore` returns `T | null`, and null means "this document did not
 * have the shape it claims" — reported by name, then dropped by the caller.
 * The alternative, which this used to do, was to cast every field and hand
 * back an object with `undefined` where a number belongs: that renders as
 * "$NaN" and sums as NaN, and there is no way to tell it from a real figure
 * after the fact.
 *
 * Dropping rather than throwing, because a throw inside a snapshot callback
 * takes the whole listener down: one bad document from last year would blank
 * the entire history instead of hiding itself.
 */
function readOnly<T>(
  fromFirestore: (snap: QueryDocumentSnapshot) => T | null,
): FirestoreDataConverter<T | null> {
  return {
    toFirestore(): DocumentData {
      throw new Error(
        "Writes must use mutations.ts (exact field sets + serverTimestamp)",
      );
    },
    fromFirestore,
  };
}

export const userConverter = readOnly<UserDoc>((snap) => {
  const data = snap.data();
  // householdId decides whether this person sees the app or onboarding, so a
  // wrong TYPE there is worth refusing: `42` is truthy and would take them
  // into households/42, which does not exist.
  if (data.householdId != null && !isString(data.householdId)) {
    return rejectDoc(`users/${snap.id}`, "householdId is not a string");
  }
  return {
    uid: snap.id,
    displayName: isMaybeEmptyString(data.displayName) ? data.displayName : "",
    householdId: isString(data.householdId) ? data.householdId : null,
    language: isOneOf(data.language, ["es", "en"] as const)
      ? data.language
      : null,
  };
});

export const householdConverter = readOnly<Household>((snap) => {
  const data = snap.data();
  const path = `households/${snap.id}`;
  // timezone is the one that would fail silently and everywhere: every ledger
  // date is computed in it, so a missing one buckets expenses by the device's
  // clock and nothing on screen looks wrong.
  if (!isString(data.timezone)) return rejectDoc(path, "timezone is missing");
  if (!isString(data.currency)) return rejectDoc(path, "currency is missing");
  if (!isStringArray(data.memberIds)) {
    return rejectDoc(path, "memberIds is not an array of strings");
  }
  const budget = data.defaultBudget;
  if (
    !isObject(budget) ||
    !isPositiveInt(budget.amountCents) ||
    !isOneOf(budget.period, ["weekly", "fortnightly"] as const) ||
    !isCalendarDate(budget.anchorDate)
  ) {
    return rejectDoc(path, "defaultBudget is not a budget");
  }
  return {
    id: snap.id,
    name: isMaybeEmptyString(data.name) ? data.name : "",
    currency: data.currency,
    timezone: data.timezone,
    defaultBudget: {
      amountCents: budget.amountCents,
      period: budget.period,
      anchorDate: budget.anchorDate,
      ...(budget.rollover === true ? { rollover: true } : {}),
    },
    memberIds: data.memberIds,
    memberProfiles: isObject(data.memberProfiles)
      ? (data.memberProfiles as Record<string, MemberProfile>)
      : {},
    categories: isObject(data.categories)
      ? (data.categories as Record<string, CategoryDef>)
      : {},
    cards: isObject(data.cards) ? (data.cards as HouseholdCards) : {},
    cardFees: readCardFees(data.cardFees),
  };
});

/** Both fields are optional on the doc, so households predating them decode. */
function readCardFees(raw: unknown): CardFeeSettings {
  if (!isObject(raw)) return { commissionArsCents: 0, usdArsRate: null };
  return {
    commissionArsCents: isInt(raw.commissionArsCents)
      ? raw.commissionArsCents
      : 0,
    // The one figure in this app that is legitimately fractional, so it is
    // checked for being finite rather than integer. A NaN here renders every
    // peso estimate as NaN.
    usdArsRate:
      typeof raw.usdArsRate === "number" && Number.isFinite(raw.usdArsRate)
        ? raw.usdArsRate
        : null,
  };
}

export const periodBudgetConverter = readOnly<PeriodBudget>((snap) => {
  // `estimate` matters for confirmedAt: by default a serverTimestamp that the
  // server has not acknowledged yet reads back as null, so the sheet would come
  // straight back after being answered and stay until the round trip finished.
  // Same reason iOS decodes bankCharges with .estimate.
  const data = snap.data({ serverTimestamps: "estimate" });
  const path = `periodBudgets/${snap.id}`;
  // All load-bearing: the two dates decide which period an expense belongs to,
  // and the amount is what "te queda" is measured against. A period that does
  // not decode is better absent than present and wrong — absent,
  // materialization notices the gap; wrong, nothing does.
  if (!isCalendarDate(data.startDate) || !isCalendarDate(data.endDate)) {
    return rejectDoc(path, "startDate or endDate is not a calendar date");
  }
  if (data.endDate <= data.startDate) {
    return rejectDoc(path, "endDate is not after startDate");
  }
  if (!isPositiveInt(data.amountCents)) {
    return rejectDoc(path, "amountCents is not a positive integer");
  }
  if (!isOneOf(data.period, ["weekly", "fortnightly"] as const)) {
    return rejectDoc(path, "period is neither weekly nor fortnightly");
  }
  return {
    startDate: data.startDate,
    endDate: data.endDate,
    period: data.period,
    amountCents: data.amountCents,
    // Falls back rather than refusing: source explains where the figure came
    // from, it does not decide anything.
    source: isOneOf(data.source, ["default", "custom"] as const)
      ? data.source
      : "default",
    rolloverCents: isInt(data.rolloverCents) ? data.rolloverCents : 0,
    // A boolean: nothing needs the instant, only whether it happened.
    confirmed: data.confirmedAt != null,
  };
});

export const expenseConverter = readOnly<Expense>((snap) => {
  const data = snap.data();
  const path = `expenses/${snap.id}`;
  // The three every total depends on. An expense with a missing amount used to
  // decode as `undefined`, which turns a period's spend into NaN: one bad
  // document making the whole budget unreadable, and nothing saying why.
  if (!isPositiveInt(data.amountCents)) {
    return rejectDoc(path, "amountCents is not a positive integer");
  }
  // Unpadded "2026-9-4" sorts before "2026-10-01" as a string, so a single one
  // lands in the wrong period for every range query in the app.
  if (!isCalendarDate(data.date)) {
    return rejectDoc(path, "date is not a calendar date");
  }
  if (!isString(data.categoryId)) {
    return rejectDoc(path, "categoryId is missing");
  }
  const expense: Expense = {
    id: snap.id,
    amountCents: data.amountCents,
    categoryId: data.categoryId,
    note: isMaybeEmptyString(data.note) ? data.note : "",
    date: data.date,
    createdBy: isString(data.createdBy) ? data.createdBy : "",
    // Absent is not zero: absent means the bank has not said what it charged,
    // zero would be a claim that it charged nothing.
    usdCents: isInt(data.usdCents) ? data.usdCents : null,
    verified: data.verified === true,
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as Timestamp | null) ?? null,
    pendingWrite: snap.metadata.hasPendingWrites,
  };
  return expense;
});

export const bankChargeConverter = readOnly<BankChargeDoc>((snap) => {
  // `estimate` matters here: dismissedAt is written with serverTimestamp(), and
  // by default a not-yet-acknowledged one reads back as null — which is exactly
  // how this file spells "pending". Without the estimate a charge would sit
  // there looking undismissed until the server answered, so pressing Descartar
  // would appear to do nothing.
  const data = snap.data({ serverTimestamps: "estimate" });
  const path = `bankCharges/${snap.id}`;
  // The collection this app does NOT write: an Apps Script does, from whatever
  // the bank's email looked like that morning. The likeliest shape to drift,
  // and the one where a charge silently missing its amount would still be
  // matched to an expense and mark it verified for nothing.
  if (!isPositiveInt(data.usdCents)) {
    return rejectDoc(path, "usdCents is not a positive integer");
  }
  if (!isCalendarDate(data.date)) {
    return rejectDoc(path, "date is not a calendar date");
  }
  const dismissedAt = data.dismissedAt as Timestamp | undefined;
  return {
    id: snap.id,
    usdCents: data.usdCents,
    date: data.date,
    merchant: isMaybeEmptyString(data.merchant) ? data.merchant : "",
    cardLast4: isString(data.cardLast4) ? data.cardLast4 : null,
    dismissedAt: dismissedAt?.toDate() ?? null,
  };
});

export const serviceConverter = readOnly<ServiceDoc>((snap) => {
  const data = snap.data();
  // The name is the entire link to the ledger: Servicios finds the expense that
  // paid a bill by matching it. A nameless service can never be reconciled, so
  // it is broken rather than incomplete.
  if (!isString(data.name)) {
    return rejectDoc(`services/${snap.id}`, "name is missing");
  }
  return {
    id: snap.id,
    name: data.name,
    // Absent means "not quoted in this currency" — distinct from zero, which
    // the rules reject outright.
    amountAudCents: isPositiveInt(data.amountAudCents)
      ? data.amountAudCents
      : null,
    amountUsdCents: isPositiveInt(data.amountUsdCents)
      ? data.amountUsdCents
      : null,
    interval: isOneOf<ServiceInterval>(data.interval, SERVICE_INTERVALS)
      ? data.interval
      : "monthly",
    // Clamped rather than refused: the day only decides when the bill falls
    // due, and a service whose name and amount are right is worth keeping even
    // if somebody typed 45.
    dueDay:
      isInt(data.dueDay) && data.dueDay >= 1 && data.dueDay <= 31
        ? data.dueDay
        : 1,
    anchorMonth:
      isInt(data.anchorMonth) && data.anchorMonth >= 1 && data.anchorMonth <= 12
        ? data.anchorMonth
        : null,
    paidWith: isOneOf<PaidWith>(data.paidWith, ["debit", "credit"] as const)
      ? data.paidWith
      : "debit",
    createdBy: isString(data.createdBy) ? data.createdBy : "",
    pendingWrite: snap.metadata.hasPendingWrites,
  };
});

export const cardStatementConverter = readOnly<CardStatement>((snap) => {
  const data = snap.data();
  const path = `cardStatements/${snap.id}`;
  // Three dates that decide which charges belong to this statement and whether
  // it has closed. One missing turns the comparison into
  // `undefined <= "2026-09-04"`, which is false, which reads as "nothing is in
  // this statement" — a plausible answer and the wrong one.
  if (!isCalendarDate(snap.id)) {
    return rejectDoc(path, "the document id is not a calendar date");
  }
  if (!isCalendarDate(data.startDate) || !isCalendarDate(data.dueDate)) {
    return rejectDoc(path, "startDate or dueDate is not a calendar date");
  }
  return {
    startDate: data.startDate,
    // The doc id IS the closing date; reading it from the id keeps the two
    // from ever disagreeing.
    closingDate: snap.id,
    dueDate: data.dueDate,
  };
});

export const cardChargeConverter = readOnly<CardCharge>((snap) => {
  const data = snap.data();
  const path = `cardCharges/${snap.id}`;
  // These add up to the statement total and then to the peso estimate with its
  // three taxes, so one undefined amount makes every figure on Tarjetas NaN.
  if (!isPositiveInt(data.usdCents)) {
    return rejectDoc(path, "usdCents is not a positive integer");
  }
  if (!isCalendarDate(data.date)) {
    return rejectDoc(path, "date is not a calendar date");
  }
  return {
    id: snap.id,
    date: data.date,
    detail: isMaybeEmptyString(data.detail) ? data.detail : "",
    card: isOneOf<CardBrand>(data.card, ["visa", "mastercard"] as const)
      ? data.card
      : "visa",
    usdCents: data.usdCents,
    // `?? true`, not `?? false`: every charge written before this field exists
    // without it, and nearly all of them were digital services.
    digital: data.digital !== false,
    verified: data.verified === true,
    createdBy: isString(data.createdBy) ? data.createdBy : "",
    pendingWrite: snap.metadata.hasPendingWrites,
  };
});

export const inviteConverter = readOnly<Invite>((snap) => {
  const data = snap.data();
  // An invite pointing nowhere would send whoever redeems it into
  // households/undefined. Refusing reads as "that code is not valid", which is
  // both true and what the join screen already knows how to say.
  if (!isString(data.householdId)) {
    return rejectDoc(`invites/${snap.id}`, "householdId is missing");
  }
  return {
    code: snap.id,
    householdId: data.householdId,
    createdBy: isString(data.createdBy) ? data.createdBy : "",
  };
});
