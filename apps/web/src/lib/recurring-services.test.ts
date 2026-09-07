import { describe, expect, it } from "vitest";

import { type ClaimedCharge, claimCharges } from "./recurring";
import { SERVICES_CATEGORY_ID, serviceStatuses } from "./services";

/**
 * A recurring rule can mark a service as charged, and nothing new was needed.
 *
 * The two features look unrelated and are deliberately separate collections —
 * a service is SCHEDULED and asks "has this month's arrived?", a rule is not
 * scheduled at all and fires when a charge lands. But they already meet, and
 * this pins where: `serviceStatuses` links a service to an expense filed in
 * the Servicios category whose NOTE is the service's name, and a rule chooses
 * the note of the expense it files. Point the rule's note at the service and
 * the bank charge closes the month on its own.
 *
 * Nothing else in the suite covers the seam, so a change to either side —
 * `nameKey` folding, the rule filing the merchant instead of the note — would
 * break it silently: the expense would still be created, still be correct, and
 * the service would just go on saying it had not been charged.
 */
describe("a recurring rule and the service it pays", () => {
  const youtube = {
    id: "svc-yt",
    name: "YouTube",
    amountAudCents: 1199,
    interval: "monthly" as const,
    dueDay: 7,
  };
  const rule = {
    id: "rule-yt",
    pattern: "Google YouTubePremium",
    categoryId: SERVICES_CATEGORY_ID,
    // The whole trick: the NOTE is the service's name, not the merchant.
    note: "YouTube",
    amountAudCents: 1199,
  };
  const charge = {
    id: "gmail-yt",
    merchant: "GOOGLE YOUTUBEPREMIUM",
    usdCents: 780,
    date: "2026-09-07",
  };

  /** What the app writes when it files a claimed charge. */
  function fileAsExpense(claim: ClaimedCharge<typeof charge>) {
    // `amountAudCents` is nullable on a claim in general — a rule that asks,
    // with no learned rate, cannot price one. These rules all carry an amount,
    // so a null here is the fixture being wrong rather than a case to handle.
    expect(claim.amountAudCents).not.toBeNull();
    return {
      id: `auto-${claim.charge.id}`,
      date: claim.charge.date,
      categoryId: claim.rule.categoryId,
      note: claim.rule.note,
      amountCents: claim.amountAudCents as number,
    };
  }

  it("files the charge under the service's own name", () => {
    const { ready } = claimCharges([charge], [rule], null);
    expect(ready).toHaveLength(1);
    expect(ready[0].rule.id).toBe("rule-yt");

    const statuses = serviceStatuses([youtube], [fileAsExpense(ready[0])], 8);
    const status = statuses.get("svc-yt");
    expect(status?.charge?.id).toBe("auto-gmail-yt");
    // And the amounts agree, so the screen says nothing is off.
    expect(status?.differenceCents).toBe(0);
  });

  it("does NOT link when the note is left as the merchant", () => {
    // The failure this seam actually has, and the reason the note field is
    // worth explaining in the UI: everything works, the expense is right, and
    // the service quietly still says it has not been charged.
    const merchantNoted = { ...rule, note: "Google Youtubepremium" };
    const { ready } = claimCharges([charge], [merchantNoted], null);
    const statuses = serviceStatuses([youtube], [fileAsExpense(ready[0])], 8);
    expect(statuses.get("svc-yt")?.charge).toBeNull();
  });

  it("ignores case and accents between the two, like the rest of the app", () => {
    const noisy = { ...rule, note: "  yóutube  " };
    const { ready } = claimCharges([charge], [noisy], null);
    const statuses = serviceStatuses([youtube], [fileAsExpense(ready[0])], 8);
    expect(statuses.get("svc-yt")?.charge?.id).toBe("auto-gmail-yt");
  });
});
