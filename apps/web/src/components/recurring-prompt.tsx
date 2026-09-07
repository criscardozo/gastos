"use client";

// What a recurring rule does when you come back.
//
// There is no server to run this — Cloud Functions need the paid plan — so the
// matching happens here, on whichever client opens first. That is not a
// workaround: "tell me next time I come in" is exactly when a client is
// running, and the charge sat in Firestore until then either way.
//
// Two halves, and only one of them is automatic. A rule that carries an amount
// FILES the charge and this reports it afterwards; a rule that does not can
// only ask, and the charge stays pending until somebody answers. Nothing is
// filed on a guess.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import type { BankChargeDoc, RecurringRuleDoc } from "@/lib/firebase/converters";
import { parseAmountToCents } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { claimCharges, type ClaimedCharge } from "@/lib/recurring";
import { DIALOG_SHELL } from "@/components/ui/dialog-shell";

export function RecurringPrompt({
  charges,
  rules,
  learnedRate,
  locale,
  onFile,
  onDismissed,
}: {
  /** The PENDING charges only — a dismissed one is not waiting for anything. */
  charges: readonly BankChargeDoc[];
  rules: readonly RecurringRuleDoc[];
  /** From BankMatch.learnRate — what prices a rule that states no amount. */
  learnedRate: number | null;
  locale: string;
  /** Files one charge under one rule, for the given AUD cents. */
  onFile: (
    charge: BankChargeDoc,
    rule: RecurringRuleDoc,
    amountAudCents: number,
    estimated: boolean,
  ) => Promise<void>;
  /** Called once the prompt is closed, so the screen can stop offering it. */
  onDismissed: () => void;
}) {
  const t = useTranslations("recurring");
  const tCommon = useTranslations("expenses");

  const { ready, asking } = claimCharges(charges, rules, learnedRate);

  // Filed once per mount, not per render.
  //
  // The listener fires again the moment the first expense lands, and without
  // this the second render would file the same charge again. The deterministic
  // expense id means a repeat would overwrite rather than duplicate — but a
  // write per render is a write per render, and the free tier is part of the
  // design.
  const [started, setStarted] = useState(false);
  const [filed, setFiled] = useState<ClaimedCharge<BankChargeDoc>[]>([]);

  useEffect(() => {
    if (started || ready.length === 0) return;
    // The latch that says filing has begun, set before the writes rather than
    // after them: the listener fires again the moment the first expense lands,
    // and a latch set afterwards would let the second render start the same
    // charges over. It cascades one render on purpose, which is the whole job.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStarted(true);
    const batch = [...ready];
    void (async () => {
      for (const claim of batch) {
        // Sequential on purpose: each is its own batch, and a burst of
        // parallel writes is how a free-tier quota disappears.
        if (claim.amountAudCents === null) continue;
        await onFile(
          claim.charge,
          claim.rule,
          claim.amountAudCents,
          claim.estimated,
        );
      }
      setFiled(batch);
    })();
  }, [ready, onFile, started]);

  const [index, setIndex] = useState(0);
  const [amount, setAmount] = useState("");

  const current = asking[index] ?? null;
  // Nothing to say only when nothing is coming, either.
  //
  // Filing is asynchronous, so between starting it and hearing back there is a
  // window where the charges have been dismissed (so `ready` is empty again)
  // and `filed` has not been set yet. Judged on those two alone the prompt
  // decided it had nothing to report and closed itself a beat before the
  // report arrived — the expense was filed correctly and silently, which is
  // the one thing this dialog exists to prevent.
  const nothingToSay =
    !started &&
    ready.length === 0 &&
    asking.length === 0 &&
    filed.length === 0;

  useEffect(() => {
    if (nothingToSay) onDismissed();
  }, [nothingToSay, onDismissed]);

  if (nothingToSay) return null;

  const cents = parseAmountToCents(amount, locale);

  const saveCurrent = async () => {
    if (current === null || cents === null) return;
    // Typed, so not an estimate.
    await onFile(current.charge, current.rule, cents, false);
    setAmount("");
    setIndex((i) => i + 1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("promptTitle")}
        className={DIALOG_SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("promptTitle")}</h2>
          <button type="button" onClick={onDismissed} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {filed.length > 0 && (
          <p className="rounded-xl bg-good-bg px-3.5 py-2.5 text-[13px] font-semibold text-good-text">
            {t("promptFiled", { count: filed.length })}
          </p>
        )}

        {current !== null ? (
          <>
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-bg px-3.5 py-3">
              <span className="text-sm font-bold text-ink">
                {current.charge.merchant}
              </span>
              <span className="text-[12px] text-ink-2">
                {formatUsd(current.charge.usdCents, locale)} ·{" "}
                {formatShortDate(current.charge.date, locale)}
              </span>
              <span className="text-[12px] text-ink-3">{current.rule.note}</span>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="section-label">{t("promptAmount")}</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                aria-label={t("promptAmount")}
                className="tnum w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>

            <div className="flex gap-2.5">
              <button
                type="button"
                disabled={cents === null}
                onClick={() => void saveCurrent()}
                className="flex-1 rounded-full bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-45"
              >
                {t("promptSave")}
              </button>
              <button
                type="button"
                onClick={onDismissed}
                className="rounded-full border border-line px-4 py-3 text-sm font-semibold text-ink-2"
              >
                {t("promptLater")}
              </button>
            </div>

            {asking.length > 1 && (
              <p className="text-center text-[11.5px] text-ink-3">
                {t("promptOf", { index: index + 1, total: asking.length })}
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={onDismissed}
            className="rounded-full bg-accent px-4 py-3 text-sm font-bold text-white"
          >
            {t("promptDone")}
          </button>
        )}
      </div>
    </div>
  );
}
