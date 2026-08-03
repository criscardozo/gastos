"use client";

// All Firestore writes. Every write matches the EXACT field set the security
// rules validate (serverTimestamp() on createdAt/updatedAt, no extras).

import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

import {
  seedCategoriesMap,
  CREATOR_COLOR,
  JOINER_COLOR,
  type CategoryDef,
} from "../categories";
import type { PeriodRange, PeriodType } from "../periods";
import { inviteConverter } from "./converters";

export const DEFAULT_CURRENCY = "AUD";
export const DEFAULT_TIMEZONE = "Australia/Sydney";

/** Create users/{uid} if missing (first sign-in). */
export async function ensureUserDoc(
  db: Firestore,
  uid: string,
  displayName: string,
): Promise<void> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    displayName: displayName || "—",
    householdId: null,
    language: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserLanguage(
  db: Firestore,
  uid: string,
  language: "es" | "en",
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    language,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserDefaultEntryCurrency(
  db: Firestore,
  uid: string,
  defaultEntryCurrency: "AUD" | "USD",
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    defaultEntryCurrency,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Create the household, then link users/{uid}.householdId — sequentially,
 * NOT in a batch, on purpose. A batch flips the user doc locally (latency
 * compensation) the moment commit() is called, so the household and
 * periodBudgets listeners that key on householdId race the server commit,
 * get permission-denied from the rules' get() on the not-yet-existing
 * household, and die permanently (the app then hangs after onboarding).
 * Awaiting the household create first guarantees the doc exists server-side
 * before any listener starts; the rules' getAfter() link check passes either
 * way. Worst case on a failure between the two writes is an invisible orphan
 * household plus the onboarding error state — strictly better than dead
 * listeners. Returns the new household id.
 */
export async function createHousehold(
  db: Firestore,
  uid: string,
  displayName: string,
  name: string,
  budgetAmountCents: number,
  period: PeriodType,
  anchorDate: string,
): Promise<string> {
  const householdRef = doc(collection(db, "households"));
  await setDoc(householdRef, {
    name,
    currency: DEFAULT_CURRENCY,
    timezone: DEFAULT_TIMEZONE,
    defaultBudget: { amountCents: budgetAmountCents, period, anchorDate },
    memberIds: [uid],
    memberProfiles: {
      [uid]: { displayName: displayName || "—", color: CREATOR_COLOR },
    },
    categories: seedCategoriesMap(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "users", uid), {
    householdId: householdRef.id,
    updatedAt: serverTimestamp(),
  });
  return householdRef.id;
}

/**
 * Join via invite code: get invites/{code} → self-add on the household
 * (rules allow touching ONLY memberIds + own memberProfiles entry +
 * updatedAt while there is a free seat) → link own user doc.
 */
export async function joinHousehold(
  db: Firestore,
  uid: string,
  displayName: string,
  rawCode: string,
): Promise<string> {
  const code = normalizeInviteCode(rawCode);
  const inviteSnap = await getDoc(
    doc(db, "invites", code).withConverter(inviteConverter),
  );
  if (!inviteSnap.exists()) throw new Error("invite-not-found");
  const { householdId } = inviteSnap.data();

  await updateDoc(doc(db, "households", householdId), {
    memberIds: arrayUnion(uid),
    [`memberProfiles.${uid}`]: {
      displayName: displayName || "—",
      color: JOINER_COLOR,
    },
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "users", uid), {
    householdId,
    updatedAt: serverTimestamp(),
  });

  // Cleanup: the household is full now, the invite is spent.
  try {
    await deleteDoc(doc(db, "invites", code));
  } catch {
    // Non-fatal: revocation is a courtesy, membership already succeeded.
  }
  return householdId;
}

/** "gd-7k2m9qx4" / "7K2M9QX4" → "GD-7K2M9QX4" (the Firestore doc ID). */
export function normalizeInviteCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[\s‑–—]/g, "-");
  return cleaned.startsWith("GD-") ? cleaned : `GD-${cleaned}`;
}

/** Crypto-random invite code, unambiguous alphabet, "GD-" prefixed. */
export function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `GD-${code}`;
}

export async function createInvite(
  db: Firestore,
  uid: string,
  householdId: string,
): Promise<string> {
  const code = generateInviteCode();
  await setDoc(doc(db, "invites", code), {
    householdId,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return code;
}

/**
 * Idempotent lazy materialization: doc ID = startDate, so two clients racing
 * write the same default content. Rules require this exact field set.
 */
export async function materializePeriods(
  db: Firestore,
  householdId: string,
  periods: PeriodRange[],
  periodType: PeriodType,
  amountCents: number,
  /** Leftover carried into the FIRST period being created (signed, 0 when
   * rollover is off). Only the first: a cascade of several missing periods
   * means the app went unopened for that long, and chaining guesses across
   * periods nobody looked at would be worse than starting fresh. */
  rolloverCents = 0,
): Promise<void> {
  await Promise.all(
    periods.map((p, index) => {
      const carried = index === 0 ? rolloverCents : 0;
      // The rules require a positive budget, so a deficit can at most empty
      // the envelope, never invert it.
      const effective = Math.max(1, amountCents + carried);
      return setDoc(
        doc(db, "households", householdId, "periodBudgets", p.startDate),
        {
          startDate: p.startDate,
          endDate: p.endDate,
          period: periodType,
          amountCents: effective,
          source: "default",
          ...(carried !== 0 ? { rolloverCents: carried } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      );
    }),
  );
}

/** Edit a period's own budget — boundaries never move. */
export async function updatePeriodAmount(
  db: Firestore,
  householdId: string,
  startDate: string,
  amountCents: number,
): Promise<void> {
  await updateDoc(
    doc(db, "households", householdId, "periodBudgets", startDate),
    { amountCents, source: "custom", updatedAt: serverTimestamp() },
  );
}

/** Rename the household. Either member may do it (the rules' member-edit
 * branch); `name` is validated there as 1..60 characters. */
export async function updateHouseholdName(
  db: Firestore,
  householdId: string,
  name: string,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId), {
    name,
    updatedAt: serverTimestamp(),
  });
}

/** Change the default template — only affects future periods. */
export async function updateDefaultBudget(
  db: Firestore,
  householdId: string,
  changes: { amountCents?: number; period?: PeriodType; rollover?: boolean },
): Promise<void> {
  const fields: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (changes.amountCents !== undefined) {
    fields["defaultBudget.amountCents"] = changes.amountCents;
  }
  if (changes.period !== undefined) {
    fields["defaultBudget.period"] = changes.period;
  }
  if (changes.rollover !== undefined) {
    fields["defaultBudget.rollover"] = changes.rollover;
  }
  await updateDoc(doc(db, "households", householdId), fields);
}

/**
 * Single write path for the household categories map (add / rename /
 * reorder / delete). `null` deletes an entry. Entries are written whole:
 * seed categories keep their translatable `key` unless the caller replaces
 * it with a literal `name` (rename), per shared/schema.md. Uses the member
 * update branch of the rules (only `categories` + `updatedAt` change).
 */
export async function updateHouseholdCategories(
  db: Firestore,
  householdId: string,
  changes: Record<string, CategoryDef | null>,
): Promise<void> {
  const fields: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [id, def] of Object.entries(changes)) {
    if (def === null) {
      fields[`categories.${id}`] = deleteField();
    } else {
      // Build the stored entry explicitly — Firestore rejects `undefined`
      // values, and key/name are mutually exclusive.
      const base = {
        icon: def.icon,
        color: def.color,
        sortOrder: def.sortOrder,
        // Written only when opted out, so the stored shape stays unchanged
        // for the default (counting) case.
        ...(def.countsToBudget === false ? { countsToBudget: false } : {}),
      };
      fields[`categories.${id}`] =
        def.key !== undefined
          ? { key: def.key, ...base }
          : { name: def.name ?? "", ...base };
    }
  }
  await updateDoc(doc(db, "households", householdId), fields);
}

export interface ExpenseInput {
  /** ALWAYS canonical AUD integer cents (converted from USD when needed). */
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  /** Set to "USD" only when the user entered in USD; omit/undefined ⇒ AUD. */
  entryCurrency?: "AUD" | "USD";
  /** The USD integer cents the user typed. Required when entryCurrency==="USD". */
  entryAmountCents?: number;
}

/** The optional bi-currency keys, written ONLY for a USD entry. Absent for AUD
 * so the doc shape stays byte-identical to the pre-bi-currency shape and the
 * rules' hasOnly() check passes (never write null/undefined). */
function entryCurrencyFields(
  input: ExpenseInput,
): { entryCurrency: "USD"; entryAmountCents: number } | null {
  if (input.entryCurrency === "USD" && input.entryAmountCents !== undefined) {
    return { entryCurrency: "USD", entryAmountCents: input.entryAmountCents };
  }
  return null;
}

export async function addExpense(
  db: Firestore,
  householdId: string,
  uid: string,
  input: ExpenseInput,
): Promise<void> {
  const ref = doc(collection(db, "households", householdId, "expenses"));
  const entry = entryCurrencyFields(input);
  await setDoc(ref, {
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    createdBy: uid,
    ...(entry ?? {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateExpense(
  db: Firestore,
  householdId: string,
  expenseId: string,
  input: ExpenseInput,
): Promise<void> {
  const entry = entryCurrencyFields(input);
  await updateDoc(doc(db, "households", householdId, "expenses", expenseId), {
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    // Switching a USD expense back to AUD must REMOVE the keys (deleteField),
    // not write null — otherwise the rules' shape check rejects the write.
    entryCurrency: entry ? entry.entryCurrency : deleteField(),
    entryAmountCents: entry ? entry.entryAmountCents : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteExpense(
  db: Firestore,
  householdId: string,
  expenseId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "expenses", expenseId));
}
