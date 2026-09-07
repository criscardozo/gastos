"use client";

// Turn a charge into a NEW expense, rather than matching it to one.
//
// The third way out of the pending list. Before this a charge with no
// counterpart could only be discarded, which is the wrong answer for a real
// purchase nobody had entered: discarding says "this was not ours".
//
// The AUD is pre-filled from the rate the household's own verified pairs
// reveal, because the bank only ever says USD and the ledger only ever holds
// AUD. Pre-filled and editable, not filed silently: the figure is a division
// until somebody looks at it, and looking at it is this dialog.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import {
  DIALOG_BACKDROP,
  DIALOG_FIELD,
  DIALOG_SHELL,
} from "@/components/ui/dialog-shell";
import type { Household } from "@/lib/firebase/converters";
import { MAX_NOTE_CHARACTERS } from "@/lib/limits";
import { formatCents, formatUsd, parseAmountToCents } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import { estimateAudCents } from "@/lib/recurring";

export function CreateFromChargeDialog({
  charge,
  household,
  locale,
  learnedRate,
  onCreate,
  onClose,
}: {
  charge: { id: string; usdCents: number; date: string; merchant: string };
  household: Household;
  locale: string;
  /** From learnRate — null until something has been verified. */
  learnedRate: number | null;
  onCreate: (input: {
    categoryId: string;
    note: string;
    amountAudCents: number;
  }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("bank");
  const tCommon = useTranslations("expenses");
  const tCat = useTranslations("categories");

  const estimate = estimateAudCents(charge.usdCents, learnedRate);
  const [amount, setAmount] = useState(
    estimate === null
      ? ""
      : formatCents(estimate, household.currency, locale).replace(/[^\d.,]/g, ""),
  );
  const [note, setNote] = useState(titleCase(charge.merchant));
  const [categoryId, setCategoryId] = useState(
    Object.keys(household.categories)[0] ?? "",
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cents = parseAmountToCents(amount, locale);
  const valid = cents !== null && note.trim() !== "" && categoryId !== "";

  const categories = Object.entries(household.categories).sort(
    ([, a], [, b]) => a.sortOrder - b.sortOrder,
  );
  const label = (id: string) => {
    const def = household.categories[id];
    if (def === undefined) return id;
    return def.key !== undefined ? tCat(def.key) : (def.name ?? id);
  };

  return (
    <div className={DIALOG_BACKDROP} role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("createExpense")}
        onClick={(event) => event.stopPropagation()}
        className={DIALOG_SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("createExpense")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {/* What the bank said, which is the whole reason this is here. */}
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-bg px-3.5 py-3">
          <span className="tnum text-sm font-bold text-ink">
            {formatUsd(charge.usdCents, locale)}
          </span>
          <span className="text-[12px] text-ink-2">
            {formatShortDate(charge.date, locale)}
            {charge.merchant !== "" && ` · ${charge.merchant}`}
          </span>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("audAmount")}</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            aria-label={t("audAmount")}
            className={`${DIALOG_FIELD} tnum`}
          />
          {estimate !== null && (
            <span className="text-[11.5px] text-ink-3">
              {t("audFromRate", {
                rate: (learnedRate ?? 0).toFixed(4).replace(".", ","),
              })}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("note")}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE_CHARACTERS}
            aria-label={t("note")}
            className={DIALOG_FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("category")}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label={t("category")}
            className={DIALOG_FIELD}
          >
            {categories.map(([id]) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (cents === null) return;
            onCreate({ categoryId, note: note.trim(), amountAudCents: cents });
          }}
          className="rounded-full bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-45"
        >
          {t("createExpense")}
        </button>
      </div>
    </div>
  );
}

/** "OPAL AUCKLAND ST" → "Opal Auckland St": the bank shouts, a ledger should not. */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, sep, first) => sep + first.toUpperCase());
}
