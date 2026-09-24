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

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import type { BankChargeDoc } from "@/lib/firebase/converters";
import { parseAmountToCents } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import { formatCents, formatUsd } from "@/lib/money";
import type { ClaimedCharge } from "@/lib/recurring";
import { DIALOG_SHELL } from "@/components/ui/dialog-shell";

export function RecurringPrompt({
  filed,
  asking,
  currency,
  locale,
  onAnswer,
  onDismissed,
}: {
  /** What the rules filed on their own, as planned — named, not counted. */
  filed: readonly ClaimedCharge<BankChargeDoc>[];
  /**
   * The questions, CAPTURED when the run was planned. Read live, answering
   * one took it out from under the index below and the next slid into the
   * slot just passed, so a second question was never asked.
   */
  asking: readonly ClaimedCharge<BankChargeDoc>[];
  /** The household's currency — the one every AUD figure is in. */
  currency: string;
  locale: string;
  /** Files one asked-about charge at the AUD cents somebody typed. */
  onAnswer: (claim: ClaimedCharge<BankChargeDoc>, amountAudCents: number) => Promise<void>;
  /** The prompt is closed; the screen resets what it reported and asked. */
  onDismissed: () => void;
}) {
  const t = useTranslations("recurring");
  const tCommon = useTranslations("expenses");

  const [index, setIndex] = useState(0);
  const [amount, setAmount] = useState("");

  const current = asking[index] ?? null;
  const cents = parseAmountToCents(amount, locale);

  const saveCurrent = async () => {
    if (current === null || cents === null) return;
    // The list is captured, so stepping forward reaches the next question
    // instead of skipping it.
    setIndex((i) => i + 1);
    setAmount("");
    await onAnswer(current, cents);
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
          // The count, and then WHICH. The count on its own was the whole
          // message, and "se cargó 1 gasto" does not answer the only question
          // anybody has here — whether it is the charge they just made.
          <div className="flex flex-col gap-1.5 rounded-xl bg-good-bg px-3.5 py-2.5">
            <p className="text-[13px] font-semibold text-good-text">
              {t("promptFiled", { count: filed.length })}
            </p>
            <ul className="flex flex-col gap-1">
              {filed.map((claim) => (
                <li key={claim.charge.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {claim.rule.note}
                    </span>
                    <span className="block text-[11.5px] text-ink-3">
                      {formatUsd(claim.charge.usdCents, locale)} ·{" "}
                      {formatShortDate(claim.charge.date, locale)}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-bold text-ink">
                    {claim.amountAudCents === null ? "" : formatCents(claim.amountAudCents, currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
