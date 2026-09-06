// Matching the bank's USD charges to the expenses they belong to.
//
// This exists TWICE — here and in apps/ios/GastosDiarios/Core/BankMatch.swift —
// and both are validated against shared/bank-match-vectors.json. Change the
// behaviour in the vectors first, then in both files, exactly as the period
// arithmetic works.
//
// The bank bills the card in USD at its own rate and reports each charge by
// email; the ingestion drops those into `households/{id}/bankCharges`. This
// module decides which unverified expense each charge is for. It is pure: no
// Firestore, no React — the page feeds it what it has already loaded.
//
// Three signals, in order of how much they actually tell us:
//
//  1. The rate. Every already-verified expense is a (AUD, USD) pair, so the
//     bank's rate is LEARNED from the household's own history (median, so one
//     odd pair can't drag it). Once known, a charge's USD nearly determines the
//     AUD it came from — this is the strongest signal by far and the reason the
//     app needs no FX API.
//  2. The merchant. The email names the establishment ("COLES 0831"), which
//     often appears in the expense note ("Coles").
//  3. The date. The authorisation lands the same day or a day or two later.
//
// Nothing here writes anything: a suggestion is a proposal the user confirms.

import { daysBetween } from "./periods";

export interface BankCharge {
  /** Gmail message id — also the Firestore doc id, so imports are idempotent. */
  id: string;
  /** What the bank charged, integer cents of USD. */
  usdCents: number;
  /** Charge date as a HOUSEHOLD-timezone calendar date. */
  date: string;
  /** Establishment as the bank spells it, e.g. "COLES 0831". May be empty. */
  merchant: string;
  cardLast4: string | null;
}

export interface MatchableExpense {
  id: string;
  amountCents: number;
  date: string;
  note: string;
  verified: boolean;
}

export interface ChargeSuggestion {
  charge: BankCharge;
  /** Best unverified expense for this charge, or null when nothing fits. */
  expenseId: string | null;
  /** 0..1 — how much the three signals agree. */
  score: number;
  /** usd / aud for the suggested pair, for display next to the learned rate. */
  impliedRate: number | null;
}

/** Days apart beyond which a charge and an expense cannot be the same thing. */
const MAX_DAY_GAP = 3;
/** Relative rate error beyond which a pair is rejected outright. */
const RATE_REJECT = 0.2;
/** Relative rate error that still scores above zero. */
const RATE_TOLERANCE = 0.1;
/** Without a learned rate, only these AUD→USD ratios are even plausible. */
const PLAUSIBLE_RATE = { min: 0.35, max: 1 };
/** Below this a suggestion is not offered — the user picks manually instead. */
const MIN_SCORE = 0.35;

/**
 * The bank's rate as the household's own verified expenses reveal it: the
 * median of usd/aud over every pair we already know. null until there is one.
 *
 * The median (not the mean) so a single mistyped verification cannot move it.
 */
export function learnRate(
  expenses: readonly (MatchableExpense & { usdCents: number | null })[],
): number | null {
  const rates = expenses
  // The `verified` filter is redundant, and deliberately kept.
  //
  // A mutation that removes it kills no test on either platform, which reads
  // as a coverage gap and is not one: `isValidVerification` in the rules makes
  // `usdCents` present imply `verified == true`, so an unverified expense
  // cannot carry a USD figure and the compactMap below would drop it anyway.
  // An equivalent mutant, noted here rather than only in the commit that found
  // it, because here is where the next person to mutate this line will look.
    .filter((e) => e.verified && e.usdCents !== null && e.amountCents > 0)
    .map((e) => (e.usdCents as number) / e.amountCents)
    .sort((a, b) => a - b);
  if (rates.length === 0) return null;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 1
    ? rates[mid]
    : (rates[mid - 1] + rates[mid]) / 2;
}

/** Lowercase, unaccented, digit-free words of 3+ letters. */
function tokens(text: string): Set<string> {
  const folded = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return new Set(
    folded
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 3),
  );
}

/** Token overlap, normalized by the shorter side so "Coles" ≈ "COLES 0831". */
function merchantScore(merchant: string, note: string): number {
  const a = tokens(merchant);
  const b = tokens(note);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** 1 for the same day, decaying to 0 past MAX_DAY_GAP. */
function dateScore(gap: number): number {
  if (gap === 0) return 1;
  if (gap === 1) return 0.7;
  if (gap === 2) return 0.4;
  return 0.2;
}

interface Pair {
  chargeId: string;
  expenseId: string;
  score: number;
  impliedRate: number;
}

/**
 * Rank every (charge, unverified expense) pair and hand each charge its best
 * still-free expense. Greedy over the global ranking, so a confident pair wins
 * its expense before a weaker pair can claim it.
 *
 * `referenceRate` is what `learnRate` returned; pass null to fall back to the
 * plausible-band check (which is all the very first charge can be judged on).
 */
export function suggestMatches(
  charges: readonly BankCharge[],
  expenses: readonly MatchableExpense[],
  referenceRate: number | null,
): ChargeSuggestion[] {
  const candidates = expenses.filter((e) => !e.verified && e.amountCents > 0);
  const pairs: Pair[] = [];

  for (const charge of charges) {
    for (const expense of candidates) {
      const gap = Math.abs(daysBetween(charge.date, expense.date));
      if (gap > MAX_DAY_GAP) continue;

      const impliedRate = charge.usdCents / expense.amountCents;
      let rateScore: number;
      if (referenceRate !== null && referenceRate > 0) {
        const error = Math.abs(impliedRate / referenceRate - 1);
        if (error > RATE_REJECT) continue;
        rateScore = Math.max(0, 1 - error / RATE_TOLERANCE);
      } else {
        if (
          impliedRate < PLAUSIBLE_RATE.min ||
          impliedRate > PLAUSIBLE_RATE.max
        ) {
          continue;
        }
        // Nothing learned yet: the rate can only say "not impossible".
        rateScore = 0.5;
      }

      pairs.push({
        chargeId: charge.id,
        expenseId: expense.id,
        impliedRate,
        score:
          0.55 * rateScore +
          0.25 * merchantScore(charge.merchant, expense.note) +
          0.2 * dateScore(gap),
      });
    }
  }

  // Highest score first; ties broken by id so the output is deterministic.
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.chargeId.localeCompare(b.chargeId) ||
      a.expenseId.localeCompare(b.expenseId),
  );

  const takenExpense = new Set<string>();
  const best = new Map<string, Pair>();
  for (const pair of pairs) {
    if (best.has(pair.chargeId) || takenExpense.has(pair.expenseId)) continue;
    if (pair.score < MIN_SCORE) continue;
    best.set(pair.chargeId, pair);
    takenExpense.add(pair.expenseId);
  }

  return charges.map((charge) => {
    const pair = best.get(charge.id);
    return {
      charge,
      expenseId: pair?.expenseId ?? null,
      score: pair?.score ?? 0,
      impliedRate: pair?.impliedRate ?? null,
    };
  });
}
