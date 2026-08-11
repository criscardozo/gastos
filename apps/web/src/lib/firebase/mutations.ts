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
  writeBatch,
  type Firestore,
} from "firebase/firestore";

import {
  seedCategoriesMap,
  CREATOR_COLOR,
  JOINER_COLOR,
  type CategoryDef,
} from "../categories";
import type { PeriodRange, PeriodType } from "../periods";
import type { PaidWith, ServiceInterval } from "../services";
import type { CardBrand, StatementRange } from "../statements";
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
  /**
   * How much of `amountCents` was carried in from the period before. Passed
   * when answering the start-period screen, where ticking or clearing the
   * leftover changes both figures: the second explains the first, so a period
   * whose amount moved without it would claim a carry-over it no longer has.
   */
  rolloverCents?: number,
): Promise<void> {
  await updateDoc(
    doc(db, "households", householdId, "periodBudgets", startDate),
    {
      amountCents,
      source: "custom",
      ...(rolloverCents === undefined ? {} : { rolloverCents }),
      updatedAt: serverTimestamp(),
    },
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
  /** AUD integer cents — the only currency anyone types. */
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
}

export async function addExpense(
  db: Firestore,
  householdId: string,
  uid: string,
  input: ExpenseInput,
): Promise<void> {
  const ref = doc(collection(db, "households", householdId, "expenses"));
  await setDoc(ref, {
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    createdBy: uid,
    // The bank's USD charge is unknown at entry time — it arrives by email
    // afterwards. Written explicitly so a fresh expense reads as unverified
    // without anyone inferring it from a missing field.
    verified: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateExpense(
  db: Firestore,
  householdId: string,
  expenseId: string,
  input: ExpenseInput,
  /**
   * Drop an existing verification along with this edit. The caller passes true
   * when the AUD amount itself changed: the bank charged for the old figure, so
   * keeping its USD would leave a pair that never existed — and those pairs are
   * what the matcher learns the bank's rate from.
   */
  clearVerification = false,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "expenses", expenseId), {
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    ...(clearVerification
      ? { usdCents: deleteField(), verified: false }
      : {}),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Record (or clear) what the bank charged for an expense in USD. `usdCents` and
 * `verified` are co-dependent in the rules, so they always move together:
 * passing null deletes the charge and drops the expense back to unverified.
 */
export async function setExpenseVerification(
  db: Firestore,
  householdId: string,
  expenseId: string,
  usdCents: number | null,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "expenses", expenseId), {
    usdCents: usdCents === null ? deleteField() : usdCents,
    verified: usdCents !== null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Match a bank charge to an expense: the expense gets the bank's USD (and so
 * becomes verified) and the charge leaves the pending list. One batch, because
 * a charge that disappeared without verifying its expense — or an expense
 * verified twice by a charge that stayed — would both be wrong.
 */
export async function assignBankCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
  expenseId: string,
  usdCents: number,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "households", householdId, "expenses", expenseId), {
    usdCents,
    verified: true,
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(db, "households", householdId, "bankCharges", chargeId));
  await batch.commit();
}

/**
 * Retire a bank charge: it has been dismissed as not ours. Deleting is how a
 * charge leaves the pending list — the Gmail label the ingestion sets is what
 * stops the same email coming back.
 */
export async function deleteBankCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
): Promise<void> {
  await deleteDoc(
    doc(db, "households", householdId, "bankCharges", chargeId),
  );
}

export async function deleteExpense(
  db: Firestore,
  householdId: string,
  expenseId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "expenses", expenseId));
}

/* ── Services ──────────────────────────────────────────────────────────── */

export interface ServiceInput {
  name: string;
  /** Integer cents. Null when the bill is not quoted in this currency. */
  amountAudCents: number | null;
  amountUsdCents: number | null;
  interval: ServiceInterval;
  dueDay: number;
  paidWith: PaidWith;
  /** Ignored when the interval is monthly — see below. */
  anchorMonth: number | null;
}

/**
 * The exact field set the rules validate: an absent amount must be ABSENT, not
 * null (the rules type-check every key that is present), and `anchorMonth` is
 * forbidden on a monthly service and required on every other interval.
 */
function serviceFields(input: ServiceInput): Record<string, unknown> {
  return {
    name: input.name,
    ...(input.amountAudCents !== null
      ? { amountAudCents: input.amountAudCents }
      : {}),
    ...(input.amountUsdCents !== null
      ? { amountUsdCents: input.amountUsdCents }
      : {}),
    interval: input.interval,
    dueDay: input.dueDay,
    ...(input.interval !== "monthly"
      ? { anchorMonth: input.anchorMonth ?? 1 }
      : {}),
    paidWith: input.paidWith,
  };
}

export async function addService(
  db: Firestore,
  householdId: string,
  uid: string,
  input: ServiceInput,
): Promise<void> {
  const ref = doc(collection(db, "households", householdId, "services"));
  await setDoc(ref, {
    ...serviceFields(input),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * An edit rewrites the whole field set, so a price or an anchor that was
 * dropped has to be DELETED rather than merely omitted — an update leaves an
 * untouched field in place, and a stale anchorMonth on a service turned monthly
 * is exactly what the rules refuse.
 */
export async function updateService(
  db: Firestore,
  householdId: string,
  serviceId: string,
  input: ServiceInput,
): Promise<void> {
  const fields = serviceFields(input);
  await updateDoc(doc(db, "households", householdId, "services", serviceId), {
    ...fields,
    ...("amountAudCents" in fields ? {} : { amountAudCents: deleteField() }),
    ...("amountUsdCents" in fields ? {} : { amountUsdCents: deleteField() }),
    ...("anchorMonth" in fields ? {} : { anchorMonth: deleteField() }),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteService(
  db: Firestore,
  householdId: string,
  serviceId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "services", serviceId));
}

/* ── Credit-card statements and charges ────────────────────────────────── */

/**
 * Open a statement. The doc id IS the closing date, so pressing "close and
 * open the next" twice — on two phones, or on a flaky connection — writes the
 * same document instead of two competing ones.
 */
export async function openCardStatement(
  db: Firestore,
  householdId: string,
  range: StatementRange,
): Promise<void> {
  await setDoc(
    doc(db, "households", householdId, "cardStatements", range.closingDate),
    {
      startDate: range.startDate,
      closingDate: range.closingDate,
      dueDate: range.dueDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
}

/** Only the due date can be corrected: the window is what buckets the charges. */
export async function updateStatementDueDate(
  db: Firestore,
  householdId: string,
  closingDate: string,
  dueDate: string,
): Promise<void> {
  await updateDoc(
    doc(db, "households", householdId, "cardStatements", closingDate),
    { dueDate, updatedAt: serverTimestamp() },
  );
}

export async function deleteCardStatement(
  db: Firestore,
  householdId: string,
  closingDate: string,
): Promise<void> {
  await deleteDoc(
    doc(db, "households", householdId, "cardStatements", closingDate),
  );
}

export interface CardChargeInput {
  date: string;
  detail: string;
  card: CardBrand;
  /** Integer cents of USD — the card's own billing currency. */
  usdCents: number;
}

export async function addCardCharge(
  db: Firestore,
  householdId: string,
  uid: string,
  input: CardChargeInput,
): Promise<void> {
  const ref = doc(collection(db, "households", householdId, "cardCharges"));
  await setDoc(ref, {
    date: input.date,
    detail: input.detail,
    card: input.card,
    usdCents: input.usdCents,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateCardCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
  input: CardChargeInput,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "cardCharges", chargeId), {
    date: input.date,
    detail: input.detail,
    card: input.card,
    usdCents: input.usdCents,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCardCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "cardCharges", chargeId));
}
