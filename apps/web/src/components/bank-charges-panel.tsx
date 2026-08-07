"use client";

// The bank's pending USD charges, waiting to be matched to an expense.
//
// The Gmail ingestion (tools/gmail-bank-ingest) drops a charge per notification
// email into `households/{id}/bankCharges`; this panel proposes which expense
// each one belongs to and the user confirms. Matching itself lives in
// lib/bank-match.ts — this file only renders it and writes the confirmed pair.
//
// Suggestions are matched against the expenses of the period the page is
// showing, which is where a charge that arrived in the last day or two lands.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  assignBankCharge,
  deleteBankCharge,
} from "@/lib/firebase/mutations";
import type { BankChargeDoc, Expense, Household } from "@/lib/firebase/converters";
import { learnRate, suggestMatches } from "@/lib/bank-match";
import { formatCents, formatUsd } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";

/** "0,652" / "0.652" — the bank's rate, as many decimals as it deserves. */
function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale === "es" ? "es-AR" : "en-AU", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rate);
}

export function BankChargesPanel({
  household,
  charges,
  expenses,
  expenseLabel,
  locale,
}: {
  household: Household;
  charges: BankChargeDoc[];
  /** Expenses of the period on screen — the pool a charge can match. */
  expenses: Expense[];
  /** Note, or the category name when the note is empty. */
  expenseLabel: (expense: Expense) => string;
  locale: string;
}) {
  const t = useTranslations("bank");
  const [open, setOpen] = useState(false);
  /** Manual overrides, charge id → expense id ("" = none chosen). */
  const [choice, setChoice] = useState<Record<string, string>>({});

  const rate = useMemo(() => learnRate(expenses), [expenses]);
  const suggestions = useMemo(
    () => suggestMatches(charges, expenses, rate),
    [charges, expenses, rate],
  );
  const unverified = useMemo(
    () => expenses.filter((e) => !e.verified),
    [expenses],
  );

  if (charges.length === 0) return null;

  const chosenFor = (chargeId: string, suggested: string | null): string =>
    choice[chargeId] ?? suggested ?? "";

  // Not awaited: see the entry forms. The batch lands in the local cache
  // immediately — the charge leaves this list and the expense shows its USD —
  // and Firestore syncs it when there is a network again.
  const assign = (charge: BankChargeDoc, expenseId: string) => {
    const fb = getFirebaseClient();
    if (fb === null || expenseId === "") return;
    void assignBankCharge(
      fb.db,
      household.id,
      charge.id,
      expenseId,
      charge.usdCents,
    );
  };

  const discard = (charge: BankChargeDoc) => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    const ok = window.confirm(
      t("discardConfirm", { amount: formatUsd(charge.usdCents, locale) }),
    );
    if (!ok) return;
    void deleteBankCharge(fb.db, household.id, charge.id);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-warn-bg">
          <Icon name="error" size={17} style={{ color: "var(--warn-text)" }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] font-bold text-ink">
            {t("pending", { count: charges.length })}
          </span>
          <span className="text-[11.5px] text-ink-3">
            {rate !== null
              ? t("hintWithRate", { rate: formatRate(rate, locale) })
              : t("hint")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded-full border border-pill bg-surface px-3.5 py-1.5 text-[12.5px] font-bold text-ink"
        >
          {open ? t("hide") : t("review")}
        </button>
      </div>

      {open && (
        <div className="flex flex-col divide-y divide-soft border-t border-soft">
          {suggestions.map(({ charge, expenseId, score, impliedRate }) => {
            const chosen = chosenFor(charge.id, expenseId);
            return (
              <div
                key={charge.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="tnum text-sm font-bold text-ink">
                    {formatUsd(charge.usdCents, locale)}
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {formatShortDate(charge.date, locale)}
                    {charge.merchant !== "" && ` · ${charge.merchant}`}
                    {charge.cardLast4 !== null && ` · ••${charge.cardLast4}`}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  <select
                    value={chosen}
                    aria-label={t("chooseExpense")}
                    onChange={(event) =>
                      setChoice({ ...choice, [charge.id]: event.target.value })
                    }
                    className="max-w-[260px] cursor-pointer truncate rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13px] font-semibold text-ink outline-none"
                  >
                    <option value="">{t("none")}</option>
                    {unverified.map((e) => (
                      <option key={e.id} value={e.id}>
                        {`${expenseLabel(e)} · ${formatCents(
                          e.amountCents,
                          household.currency,
                          locale,
                        )} · ${formatShortDate(e.date, locale)}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] font-semibold text-ink-3">
                    {/* The implied rate is the reason the suggestion exists,
                        so it is shown rather than a bare confidence bar. */}
                    {expenseId === null
                      ? t("noCandidate")
                      : t("suggested", {
                          rate: formatRate(impliedRate ?? 0, locale),
                          score: Math.round(score * 100),
                        })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => assign(charge, chosen)}
                    disabled={chosen === ""}
                    className="rounded-full bg-accent px-3.5 py-[7px] text-[12.5px] font-bold text-white disabled:opacity-40"
                  >
                    {t("assign")}
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(charge)}
                    className="text-[12.5px] font-semibold text-ink-2 disabled:opacity-40"
                  >
                    {t("discard")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
