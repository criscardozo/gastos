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
import type { PaidWith, ServiceInterval } from "../services";
import type { CardBrand } from "../statements";

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

function readOnly<T>(
  fromFirestore: (snap: QueryDocumentSnapshot) => T,
): FirestoreDataConverter<T> {
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
  return {
    uid: snap.id,
    displayName: (data.displayName as string) ?? "",
    householdId: (data.householdId as string | null) ?? null,
    language: (data.language as "es" | "en" | null) ?? null,
  };
});

export const householdConverter = readOnly<Household>((snap) => {
  const data = snap.data();
  return {
    id: snap.id,
    name: data.name as string,
    currency: data.currency as string,
    timezone: data.timezone as string,
    defaultBudget: data.defaultBudget as DefaultBudget,
    memberIds: data.memberIds as string[],
    memberProfiles: data.memberProfiles as Record<string, MemberProfile>,
    categories: data.categories as Record<string, CategoryDef>,
    cards: (data.cards as HouseholdCards | undefined) ?? {},
    cardFees: readCardFees(data.cardFees),
  };
});

/** Both fields are optional on the doc, so households predating them decode. */
function readCardFees(raw: unknown): CardFeeSettings {
  const fees = (raw ?? {}) as Partial<CardFeeSettings>;
  return {
    commissionArsCents: fees.commissionArsCents ?? 0,
    usdArsRate: fees.usdArsRate ?? null,
  };
}

export const periodBudgetConverter = readOnly<PeriodBudget>((snap) => {
  // `estimate` matters for confirmedAt: by default a serverTimestamp that the
  // server has not acknowledged yet reads back as null, so the sheet would come
  // straight back after being answered and stay until the round trip finished.
  // Same reason iOS decodes bankCharges with .estimate.
  const data = snap.data({ serverTimestamps: "estimate" });
  return {
    startDate: data.startDate as string,
    endDate: data.endDate as string,
    period: data.period as PeriodType,
    amountCents: data.amountCents as number,
    source: data.source as "default" | "custom",
    rolloverCents: (data.rolloverCents as number | undefined) ?? 0,
    // A boolean: nothing needs the instant, only whether it happened.
    confirmed: data.confirmedAt != null,
  };
});

export const expenseConverter = readOnly<Expense>((snap) => {
  const data = snap.data();
  const expense: Expense = {
    id: snap.id,
    amountCents: data.amountCents as number,
    categoryId: data.categoryId as string,
    note: data.note as string,
    date: data.date as string,
    createdBy: data.createdBy as string,
    usdCents: (data.usdCents as number | undefined) ?? null,
    verified: (data.verified as boolean | undefined) === true,
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
  const dismissedAt = data.dismissedAt as Timestamp | undefined;
  return {
    id: snap.id,
    usdCents: data.usdCents as number,
    date: data.date as string,
    merchant: (data.merchant as string | undefined) ?? "",
    cardLast4: (data.cardLast4 as string | undefined) ?? null,
    dismissedAt: dismissedAt?.toDate() ?? null,
  };
});

export const serviceConverter = readOnly<ServiceDoc>((snap) => {
  const data = snap.data();
  return {
    id: snap.id,
    name: (data.name as string) ?? "",
    // Absent means "not quoted in this currency" — distinct from zero, which
    // the rules reject outright.
    amountAudCents: (data.amountAudCents as number | undefined) ?? null,
    amountUsdCents: (data.amountUsdCents as number | undefined) ?? null,
    interval: (data.interval as ServiceInterval) ?? "monthly",
    dueDay: (data.dueDay as number | undefined) ?? 1,
    anchorMonth: (data.anchorMonth as number | undefined) ?? null,
    paidWith: (data.paidWith as PaidWith) ?? "debit",
    createdBy: (data.createdBy as string) ?? "",
    pendingWrite: snap.metadata.hasPendingWrites,
  };
});

export const cardStatementConverter = readOnly<CardStatement>((snap) => {
  const data = snap.data();
  return {
    startDate: data.startDate as string,
    // The doc id IS the closing date; reading it from the id keeps the two
    // from ever disagreeing.
    closingDate: snap.id,
    dueDate: data.dueDate as string,
  };
});

export const cardChargeConverter = readOnly<CardCharge>((snap) => {
  const data = snap.data();
  return {
    id: snap.id,
    date: data.date as string,
    detail: (data.detail as string | undefined) ?? "",
    card: (data.card as CardBrand) ?? "visa",
    usdCents: data.usdCents as number,
    // `?? true`, not `?? false`: every charge written before this field exists
    // without it, and nearly all of them were digital services.
    digital: (data.digital as boolean | undefined) ?? true,
    verified: (data.verified as boolean | undefined) ?? false,
    createdBy: (data.createdBy as string) ?? "",
    pendingWrite: snap.metadata.hasPendingWrites,
  };
});

export const inviteConverter = readOnly<Invite>((snap) => {
  const data = snap.data();
  return {
    code: snap.id,
    householdId: data.householdId as string,
    createdBy: data.createdBy as string,
  };
});
