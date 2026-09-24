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
import type { HouseholdCards } from "../cards";
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
  // A code whose document does not decode is the same answer as a code that
  // does not exist: it cannot take anyone anywhere, and the join screen already
  // knows how to say so.
  const invite = inviteSnap.data();
  if (invite === null) throw new Error("invite-not-found");
  const { householdId } = invite;

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
  /**
   * Where the figure came from — the household's default, or somebody typing
   * one. Defaults to "custom" for the callers that only ever set an amount by
   * hand (Ajustes).
   *
   * It used to be hardcoded to "custom" here, which made the badge lie in a
   * way that took a while to spot. Declining the carry-over writes a DIFFERENT
   * amount than the materialized one — 170 instead of 170 plus the leftover —
   * so it took this path and the period came out marked "Ajustado" while
   * reading exactly the usual figure. Reported that way: "si siempre es 170,
   * no está ajustado, sólo no acarreamos la semana anterior".
   *
   * The two answers on the start-period screen are the two sources, and the
   * screen knows which button was pressed. It is not inferable from the
   * numbers: 170 can be the default (carry declined) or a typed figure that
   * happens to match.
   */
  source: "default" | "custom" = "custom",
): Promise<void> {
  await updateDoc(
    doc(db, "households", householdId, "periodBudgets", startDate),
    {
      amountCents,
      source,
      ...(rolloverCents === undefined ? {} : { rolloverCents }),
      // Answering the screen with a figure IS answering for this period.
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
}

/**
 * Record that somebody answered the start-period sheet, accepting the budget
 * as it stands.
 *
 * Its own write because accepting the offered amount changes no figure — and
 * the old code therefore wrote NOTHING, leaving the answer in this device's
 * localStorage. The web then asked again, and so did the other member's phone,
 * every period. The rules accept this shape once and refuse to let it be
 * changed or taken back.
 */
export async function confirmPeriod(
  db: Firestore,
  householdId: string,
  startDate: string,
): Promise<void> {
  await updateDoc(
    doc(db, "households", householdId, "periodBudgets", startDate),
    { confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() },
  );
}

/** Rename the household. Either member may do it (the rules' member-edit
 * branch); `name` is validated there as 1..60 characters. */
/**
 * Stretch the week under way into a fortnight: the end date moves out by a
 * week and the budget grows by whatever is being added for it.
 *
 * The one write in this app that moves a period boundary. It is safe precisely
 * because expenses are bucketed by date rather than by a stored period id —
 * the days that were about to belong to the next period now belong to this one,
 * and not a single expense doc is touched. The rules fence this in to
 * weekly → fortnightly, forwards only, with the start date and the carried-in
 * figure untouched.
 *
 * `endDate` must come from `extendToFortnight` — the rules have no date
 * arithmetic and cannot check it, so the shared vectors are what keep both
 * clients computing the same day.
 *
 * `swallowedStartDate` is the period the new end date runs over, when one has
 * already been materialized, and it goes in the SAME batch. Without that this
 * left two periods claiming the same days — and it did, for three weeks: a
 * fortnight 7–20 August beside the week 14–20 that had been created before the
 * extension. An expense in those days then belongs to whichever period the
 * client's search happens to return first, and the two clients search
 * differently (the web takes the first match, iOS the last), so they disagreed
 * about the budget for that week. Deletes were forbidden by the rules when
 * this was written, which is why it shipped one-sided.
 */
export async function extendPeriodToFortnight(
  db: Firestore,
  householdId: string,
  startDate: string,
  endDate: string,
  amountCents: number,
  swallowedStartDate: string | null,
): Promise<void> {
  const periods = collection(db, "households", householdId, "periodBudgets");
  const batch = writeBatch(db);
  batch.update(
    doc(periods, startDate),
    {
      period: "fortnightly",
      endDate,
      amountCents,
      // The amount no longer came from the default template, whatever it was.
      source: "custom",
      updatedAt: serverTimestamp(),
    },
  );
  // Only ever a period nobody has answered: the rules refuse to delete one
  // carrying confirmedAt, and the caller only offers up the next one along.
  if (swallowedStartDate !== null) {
    batch.delete(doc(periods, swallowedStartDate));
  }
  await batch.commit();
}

/**
 * Stretch the last period out to `toEndDate` and drop the one it swallows.
 *
 * ONE batch, and that is the whole safety argument. Moving an end date past the
 * next period's start leaves two ranges claiming the same days, and an expense
 * belongs to whichever range holds its date — so for the moment between the two
 * writes, some days would belong to two budgets. Committing them together means
 * that moment does not exist.
 *
 * The amount does not move: stretching buys days, not money. The point is to
 * spend what is already left over across a few more days so the NEXT period can
 * start on a different weekday — materialization always chains from the last
 * period's end date plus one.
 *
 * `dropStartDate` is the freshly materialized, unanswered period being replaced.
 * Nothing of value goes with it: it holds no expenses (those live in `expenses`,
 * bucketed by date) and no decision (that is what `confirmedAt` records), and
 * the cascade rebuilds the chain from the new end date.
 */
export async function stretchPeriod(
  db: Firestore,
  householdId: string,
  startDate: string,
  toEndDate: string,
  dropStartDate: string | null,
): Promise<void> {
  const periods = collection(db, "households", householdId, "periodBudgets");
  const batch = writeBatch(db);
  batch.update(doc(periods, startDate), {
    endDate: toEndDate,
    updatedAt: serverTimestamp(),
  });
  if (dropStartDate !== null) {
    batch.delete(doc(periods, dropStartDate));
  }
  await batch.commit();
}

/**
 * Ask the Gmail ingestion to run now.
 *
 * Two steps, and the ORDER is the security model. The stamp goes in first: only
 * a member can write it (the rules say so) and it must carry the server's
 * clock, so it is a fact rather than a claim. The ping second: the Apps Script
 * endpoint is public — a native app has no useful way to authenticate to one —
 * and it does no work unless it finds that stamp within a couple of minutes.
 *
 * The ping is deliberately not awaited for its body and its failure is
 * swallowed: the button is a convenience and the 15-minute trigger is the real
 * guarantee, so the worst case of a failed ping is the wait it was skipping.
 * `mode: "no-cors"` because Apps Script does not answer preflight — the
 * response is unreadable, which is fine since nothing here reads it.
 */
export async function requestBankIngest(
  db: Firestore,
  householdId: string,
  endpoint: string | null,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId), {
    ingestRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (endpoint === null) return;
  try {
    await fetch(endpoint, { method: "POST", mode: "no-cors" });
  } catch {
    // Left for the next scheduled run.
  }
}

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
/**
 * Replace the household's cards. Written whole rather than per entry: the map
 * is tiny, and a partial update through dotted paths would need the digits to be
 * escaped — the exact trap `setCategory` documents on the iOS side.
 */
export async function updateHouseholdCards(
  db: Firestore,
  householdId: string,
  cards: HouseholdCards,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId), {
    cards,
    updatedAt: serverTimestamp(),
  });
}

/**
 * The ARS settings for card statements: the bank's fixed monthly fee and the
 * fallback rate. Written whole for the same reason as `cards` — the map has two
 * keys and a dotted path buys nothing. Member-edit branch of the rules.
 */
export async function updateHouseholdCardFees(
  db: Firestore,
  householdId: string,
  fees: { commissionArsCents: number; usdArsRate: number | null },
): Promise<void> {
  // The rules type `usdArsRate` as a number when present, so "not configured"
  // has to be an absent key rather than a null.
  const cardFees: Record<string, number> = {
    commissionArsCents: fees.commissionArsCents,
  };
  if (fees.usdArsRate !== null) cardFees.usdArsRate = fees.usdArsRate;
  await updateDoc(doc(db, "households", householdId), {
    cardFees,
    updatedAt: serverTimestamp(),
  });
}

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
 * Discard a bank charge as not ours. This does NOT delete: the charge leaves
 * the pending list but stays recoverable for 48 hours (see lib/bank-charges.ts),
 * because dismissing is one press and there is no other way back — the
 * ingestion's memory of processed Gmail message ids means no future sweep will
 * re-import it.
 *
 * serverTimestamp() rather than a local clock: the rules only accept the
 * server's own time, so neither client can decide how long its mistakes stay
 * recoverable.
 */
export async function dismissBankCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "bankCharges", chargeId), {
    dismissedAt: serverTimestamp(),
  });
}

/**
 * Take a dismissal back: the charge returns to the pending list — and the
 * expense it was filed as goes with it, if it was filed rather than thrown
 * away.
 *
 * One batch, and the delete is unconditional because it has to be safe without
 * a read: the expense id is derived from the charge, so deleting one that was
 * never created does nothing, while leaving one that WAS created is the same
 * purchase counted twice.
 *
 * The panel tries not to offer Restaurar on a filed charge at all
 * (`wasFiledAsExpense`), but it can only look among the expenses of the range
 * on screen, so a charge filed into any other range is offered anyway. That
 * check cannot be made complete without reading every period; this makes the
 * destructive half harmless instead. The e2e "restoring a charge filed OUTSIDE
 * the range" holds it — measured failing before this: the charge back in the
 * pending list with its expense still there. Same fix as iOS's, which went in
 * first while this half was left.
 */
export async function restoreBankCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "households", householdId, "expenses", autoExpenseId(chargeId)));
  batch.update(doc(db, "households", householdId, "bankCharges", chargeId), {
    dismissedAt: deleteField(),
  });
  await batch.commit();
}

/**
 * Delete a charge for good. Two callers, and only two: the sweep that clears
 * dismissals past the window, and the batch that matches a charge to an expense
 * (there deleting is right — reconciling is not a mistake to take back).
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

/**
 * Tick or untick "checked against the paper statement".
 *
 * Its own mutation rather than a field on CardChargeInput: this is a one-tap
 * action from the list, and routing it through the edit dialog's payload would
 * make ticking a box rewrite the amount, the date and the card along with it.
 */
export async function setCardChargeVerified(
  db: Firestore,
  householdId: string,
  chargeId: string,
  verified: boolean,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "cardCharges", chargeId), {
    verified,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Move charges into the statement that starts on `startDate`.
 *
 * A charge carries no statement id — it belongs to whichever window contains
 * its date — so moving one means CHANGING ITS DATE, and that is the whole
 * mechanism. Used when closing a statement: a charge nobody could tick off
 * against the paper bill probably was not on it, and belongs to the next one.
 *
 * One batch: half-moved charges would be split across two statements with no
 * way to tell which half went where.
 */
export async function moveCardChargesToStatement(
  db: Firestore,
  householdId: string,
  chargeIds: readonly string[],
  startDate: string,
): Promise<void> {
  if (chargeIds.length === 0) return;
  const batch = writeBatch(db);
  for (const id of chargeIds) {
    batch.update(doc(db, "households", householdId, "cardCharges", id), {
      date: startDate,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
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
  /** Whether the bank will treat this as a digital service from abroad. */
  digital: boolean;
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
    digital: input.digital,
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
    digital: input.digital,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Turn one of the bank's charges into a card charge: the statement gains the
 * line, and the charge leaves the pending list. ONE batch, for the same reason
 * `assignBankCharge` is one — a charge that vanished without becoming anything,
 * or a line recorded twice by a charge that stayed, are both wrong.
 *
 * The charge keeps its own date, so it lands in whichever statement's window
 * contains it. That may not be the statement on screen, and that is correct:
 * the date is what files it, not what the user happens to be looking at.
 */
export async function importBankChargeAsCardCharge(
  db: Firestore,
  householdId: string,
  uid: string,
  chargeId: string,
  input: CardChargeInput,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "households", householdId, "cardCharges")), {
    date: input.date,
    detail: input.detail,
    card: input.card,
    usdCents: input.usdCents,
    digital: input.digital,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(db, "households", householdId, "bankCharges", chargeId));
  await batch.commit();
}

export async function deleteCardCharge(
  db: Firestore,
  householdId: string,
  chargeId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "cardCharges", chargeId));
}

// ---------------------------- recurring rules ----------------------------

export interface RecurringRuleInput {
  pattern: string;
  categoryId: string;
  note: string;
  /** Null is the rule saying "ask me" — written as an ABSENT field, never 0. */
  amountAudCents: number | null;
}

function recurringFields(input: RecurringRuleInput) {
  return {
    pattern: input.pattern.trim(),
    categoryId: input.categoryId,
    note: input.note.trim(),
    // Absent, not zero. The rules refuse a zero and reading one back as "ask
    // me" would make the two states indistinguishable in the data.
    ...(input.amountAudCents === null
      ? {}
      : { amountAudCents: input.amountAudCents }),
  };
}

/** Returns the new rule's id, so the caller can apply it straight away. */
export async function addRecurringRule(
  db: Firestore,
  householdId: string,
  uid: string,
  input: RecurringRuleInput,
): Promise<string> {
  const ref = doc(collection(db, "households", householdId, "recurringRules"));
  await setDoc(ref, {
    ...recurringFields(input),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateRecurringRule(
  db: Firestore,
  householdId: string,
  ruleId: string,
  input: RecurringRuleInput,
): Promise<void> {
  const ref = doc(db, "households", householdId, "recurringRules", ruleId);
  await updateDoc(ref, {
    ...recurringFields(input),
    // An edit that clears the amount has to REMOVE the field, not write null:
    // the rules only accept an int or nothing, and "ask me" is the absence.
    ...(input.amountAudCents === null ? { amountAudCents: deleteField() } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteRecurringRule(
  db: Firestore,
  householdId: string,
  ruleId: string,
): Promise<void> {
  await deleteDoc(doc(db, "households", householdId, "recurringRules", ruleId));
}

/**
 * The expense id a charge always files under.
 *
 * Derived rather than generated because both clients may be open when a charge
 * arrives, and both will match it against the same rule. Racing on a
 * deterministic id writes the same document twice; racing on a generated one
 * writes the expense twice, and the second is indistinguishable from a real
 * duplicate. Firestore ids allow this alphabet, and the Gmail message id the
 * charge is keyed by is already unique.
 */
const AUTO_PREFIX = "auto_";

export function autoExpenseId(chargeId: string): string {
  return `${AUTO_PREFIX}${chargeId}`.slice(0, 1500);
}

/**
 * The charge an auto-filed expense came from, or null when the id says it was
 * not one.
 *
 * The inverse belongs beside the function it inverts. Written out by hand at
 * the call site, the prefix would be in two places and the undo would silently
 * point at the wrong document the day the prefix changed.
 */
export function chargeIdFromAutoExpense(expenseId: string): string | null {
  return expenseId.startsWith(AUTO_PREFIX)
    ? expenseId.slice(AUTO_PREFIX.length)
    : null;
}

/**
 * File a charge as an expense.
 *
 * One batch, because the two halves cannot be allowed to separate: an expense
 * without the charge dismissed would be offered again, and a charge dismissed
 * without the expense would lose the money silently.
 *
 * The charge is DISMISSED rather than deleted, which is what makes the undo
 * possible — it is the same 48-hour recoverable window a member gets when they
 * discard a charge by hand, expiring by the same sweep. See lib/bank-charges.ts.
 *
 * One function for both ways in, because they differ by one field: a rule
 * recognised it (`rule` given, and the expense records which), or somebody
 * pressed "Crear gasto" on it. Two copies of a batch that has to stay atomic
 * is how the halves come apart.
 */
export async function fileChargeAsExpense(
  db: Firestore,
  householdId: string,
  uid: string,
  charge: { id: string; usdCents: number; date: string },
  expense: { categoryId: string; note: string; amountAudCents: number },
  /** The rule that recognised it, when one did. */
  rule?: { id: string; estimated: boolean },
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(
    doc(db, "households", householdId, "expenses", autoExpenseId(charge.id)),
    {
      amountCents: expense.amountAudCents,
      categoryId: expense.categoryId,
      note: expense.note,
      // The charge's own date, already in the household timezone — the
      // ingestion converted it. Never today's: a charge that arrives on Monday
      // for a Saturday purchase belongs to Saturday's period.
      date: charge.date,
      createdBy: uid,
      // What the bank actually charged, so the pairing is the verification.
      usdCents: charge.usdCents,
      verified: true,
      ...(rule === undefined ? {} : { autoRuleId: rule.id }),
      // Absent rather than false: the rules accept only `true`, so the two
      // spellings of "no" cannot disagree.
      ...(rule?.estimated === true ? { autoEstimated: true } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
  batch.update(doc(db, "households", householdId, "bankCharges", charge.id), {
    dismissedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** A charge a recurring rule recognised. */
export async function fileRecurringExpense(
  db: Firestore,
  householdId: string,
  uid: string,
  charge: { id: string; usdCents: number; date: string },
  rule: { id: string; categoryId: string; note: string },
  amountAudCents: number,
  estimated = false,
): Promise<void> {
  await fileChargeAsExpense(
    db,
    householdId,
    uid,
    charge,
    { categoryId: rule.categoryId, note: rule.note, amountAudCents },
    { id: rule.id, estimated },
  );
}

/**
 * Take back an expense a rule filed, and put its charge back in the list.
 *
 * The mirror of the above, in one batch for the same reason. Only possible
 * while the charge is still there — past the 48 hours the sweep has removed
 * it, and what is left is an ordinary expense to be edited or deleted like any
 * other.
 */
export async function undoRecurringExpense(
  db: Firestore,
  householdId: string,
  expenseId: string,
  chargeId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "households", householdId, "expenses", expenseId));
  batch.update(doc(db, "households", householdId, "bankCharges", chargeId), {
    dismissedAt: deleteField(),
  });
  await batch.commit();
}

/**
 * Point an expense's note at a service, which is how the two get linked.
 *
 * Servicios reads the link off the name and stores nothing, so "linking" is
 * literally renaming the note. One field, so a plain update rather than a
 * batch — and reversible by editing the expense, which is where somebody
 * would look to undo it.
 */
export async function renameExpenseNote(
  db: Firestore,
  householdId: string,
  expenseId: string,
  note: string,
): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "expenses", expenseId), {
    note,
    updatedAt: serverTimestamp(),
  });
}

