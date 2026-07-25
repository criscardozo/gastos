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

export interface UserDoc {
  uid: string;
  displayName: string;
  householdId: string | null;
  language: "es" | "en" | null;
  /** Which currency the expense-entry toggle starts on. null ⇒ AUD. */
  defaultEntryCurrency: "AUD" | "USD" | null;
}

export interface MemberProfile {
  displayName: string;
  color: string;
}

export interface DefaultBudget {
  amountCents: number;
  period: PeriodType;
  anchorDate: string;
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
}

export interface PeriodBudget {
  startDate: string;
  endDate: string;
  period: PeriodType;
  amountCents: number;
  source: "default" | "custom";
}

export interface Expense {
  id: string;
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  createdBy: string;
  createdAt: Timestamp | null;
  /** Currency the user actually typed in. Absent ⇒ entered in AUD (canonical). */
  entryCurrency?: "AUD" | "USD";
  /** Original amount in `entryCurrency`. Present iff `entryCurrency` is. Display-only. */
  entryAmountCents?: number;
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
    defaultEntryCurrency:
      (data.defaultEntryCurrency as "AUD" | "USD" | null) ?? null,
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
  };
});

export const periodBudgetConverter = readOnly<PeriodBudget>((snap) => {
  const data = snap.data();
  return {
    startDate: data.startDate as string,
    endDate: data.endDate as string,
    period: data.period as PeriodType,
    amountCents: data.amountCents as number,
    source: data.source as "default" | "custom",
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
    createdAt: (data.createdAt as Timestamp | null) ?? null,
  };
  // Bi-currency: read the optional entry fields only when both are present
  // (schema guarantees they are co-dependent). Absent ⇒ entered in AUD.
  if (
    (data.entryCurrency === "AUD" || data.entryCurrency === "USD") &&
    typeof data.entryAmountCents === "number"
  ) {
    expense.entryCurrency = data.entryCurrency;
    expense.entryAmountCents = data.entryAmountCents;
  }
  return expense;
});

export const inviteConverter = readOnly<Invite>((snap) => {
  const data = snap.data();
  return {
    code: snap.id,
    householdId: data.householdId as string,
    createdBy: data.createdBy as string,
  };
});
