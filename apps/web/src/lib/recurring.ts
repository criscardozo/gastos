/**
 * Recurring-expense rules: a merchant pattern the household recognises, and
 * what to file it as when the bank reports it.
 *
 * Distinct from Servicios on purpose. A service is SCHEDULED — Netflix on the
 * 7th, the insurance every quarter — and the screen asks "has this month's
 * arrived?". A rule here is not scheduled at all: an Opal top-up happens when
 * it happens, and what triggers it is the charge landing, not a date. So this
 * one is driven by the bank and Servicios by the calendar, and neither can
 * answer the other's question.
 *
 * The matching runs on the CLIENT, next time one opens — there is no server to
 * run it (Cloud Functions need the paid plan). That is not a compromise here:
 * "avisame la próxima vez que entro" is exactly when a client is running.
 *
 * The rules are the only boundary, so nothing here is a security check.
 */

/** Lowercase, unaccented. The same folding the bank matcher uses on merchants. */
function fold(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export interface RecurringRule {
  id: string;
  /** What to look for in the merchant, e.g. "Opal*". */
  pattern: string;
  /** Where the expense is filed. Required: an expense cannot exist without one. */
  categoryId: string;
  /** What to write as the note. */
  note: string;
  /** What it usually costs in AUD. Null means "ask me when one arrives". */
  amountAudCents: number | null;
}

/**
 * Does this pattern claim this merchant?
 *
 * A pattern with no `*` matches as a SUBSTRING, because that is how a person
 * writes one: typing "Opal" to catch "OPAL AUCKLAND ST" is the obvious intent,
 * and requiring an anchor would make the common case the fiddly one. A `*` is
 * what tightens it: "Opal*" anchors the start, "*TOPUP" the end. Not a regular
 * expression — every other character is literal, so a merchant with a `+` or a
 * `.` in it can be matched by typing it.
 *
 * An empty pattern, or one made only of stars, matches NOTHING. Left to the
 * general rule it would claim every charge that ever arrives, which is the one
 * outcome a rule must never have.
 */
export function matchesPattern(pattern: string, merchant: string): boolean {
  const p = fold(pattern);
  const m = fold(merchant);
  if (p === "" || m === "") return false;
  if (p.replaceAll("*", "") === "") return false;

  const parts = p.split("*");
  if (parts.length === 1) return m.includes(parts[0]);

  // Anchored at whichever end has no star, spanning whatever is between.
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1);

  let cursor = 0;
  if (first !== "") {
    if (!m.startsWith(first)) return false;
    cursor = first.length;
  }
  for (const piece of middle) {
    if (piece === "") continue;
    const at = m.indexOf(piece, cursor);
    if (at === -1) return false;
    cursor = at + piece.length;
  }
  if (last !== "") {
    if (!m.endsWith(last)) return false;
    // The tail must sit after everything already consumed, so "A*B" cannot be
    // satisfied by one occurrence playing both parts.
    if (m.length - last.length < cursor) return false;
  }
  return true;
}

/**
 * The rule that claims this charge, or null.
 *
 * Ordered by how specific the pattern is — the longer one wins — and then by
 * the pattern itself so the answer is the same on both clients. Deliberately
 * NOT by document id: the two clients would agree on the id but a reader
 * cannot predict it, and "which rule fired" is something a person has to be
 * able to work out from what they typed.
 */
export function ruleForCharge(
  rules: readonly RecurringRule[],
  merchant: string,
): RecurringRule | null {
  const claiming = rules.filter((r) => matchesPattern(r.pattern, merchant));
  if (claiming.length === 0) return null;
  return [...claiming].sort(
    (a, b) =>
      fold(b.pattern).length - fold(a.pattern).length ||
      fold(a.pattern).localeCompare(fold(b.pattern)),
  )[0];
}

/**
 * The little of a charge this module needs, declared here rather than imported.
 *
 * Same reason bank-match.ts declares its own: the matching is about a merchant
 * string, and a module that took the whole document would be harder to test
 * and would drag the converters in behind it.
 */
export interface MatchableCharge {
  id: string;
  merchant: string;
}

/**
 * The AUD a charge probably was, when the rule does not say.
 *
 * The household's own verified pairs reveal the rate the bank uses
 * (`BankMatch.learnRate`), so a charge a rule recognises can be filed at that
 * rate instead of waiting for somebody to type a figure — which is what left
 * charges hanging in the list.
 *
 * Null when there is nothing to estimate from: no rate learned yet, a rate
 * that is not a rate, or an estimate that would round to zero. Zero would read
 * as an expense that cost nothing, and the rules refuse it anyway.
 */
export function estimateAudCents(
  usdCents: number,
  rate: number | null,
): number | null {
  if (rate === null || rate <= 0) return null;
  const cents = Math.round(usdCents / rate);
  return cents > 0 ? cents : null;
}

/** A pending charge, the rule that claims it, and what to file it for. */
export interface ClaimedCharge<T extends MatchableCharge> {
  charge: T;
  rule: RecurringRule;
  /** Null when neither the rule nor the learned rate can price it. */
  amountAudCents: number | null;
  /** True when the amount is a division rather than a figure anybody stated. */
  estimated: boolean;
}

/**
 * The pending charges a rule claims, split by whether they can be filed.
 *
 * `ready` can: either the rule states the amount, or the household's own
 * verified pairs reveal the rate and it is worked out from the bank's USD.
 * `asking` is what is left — a rule with no amount and nothing to estimate
 * from, which happens only before anything has ever been verified.
 *
 * The estimate exists because the alternative was leaving the charge in the
 * pending list until somebody typed a figure, and a charge a rule already
 * recognised sitting there unhandled is the thing this feature was supposed to
 * remove.
 */
export function claimCharges<T extends MatchableCharge & { usdCents: number }>(
  charges: readonly T[],
  rules: readonly RecurringRule[],
  /** From BankMatch.learnRate — null until something has been verified. */
  learnedRate: number | null,
): { ready: ClaimedCharge<T>[]; asking: ClaimedCharge<T>[] } {
  const ready: ClaimedCharge<T>[] = [];
  const asking: ClaimedCharge<T>[] = [];
  for (const charge of charges) {
    const rule = ruleForCharge(rules, charge.merchant);
    if (rule === null) continue;
    if (rule.amountAudCents !== null) {
      ready.push({
        charge,
        rule,
        amountAudCents: rule.amountAudCents,
        estimated: false,
      });
      continue;
    }
    const estimate = estimateAudCents(charge.usdCents, learnedRate);
    const claim: ClaimedCharge<T> = {
      charge,
      rule,
      amountAudCents: estimate,
      estimated: estimate !== null,
    };
    (estimate === null ? asking : ready).push(claim);
  }
  return { ready, asking };
}

/**
 * What a rule claims out of the charges waiting RIGHT NOW.
 *
 * Saving a rule used to change nothing until the app was next opened, which is
 * exactly backwards: the way you make a rule is by seeing a charge you
 * recognise and pressing the icon on it, so that charge is the first thing the
 * rule should file. It sat in the pending list instead, and the rule looked
 * like it had not worked.
 */
export function claimsOfOneRule<T extends MatchableCharge & { usdCents: number }>(
  charges: readonly T[],
  rule: RecurringRule,
  learnedRate: number | null,
): ClaimedCharge<T>[] {
  return claimCharges(charges, [rule], learnedRate).ready;
}
