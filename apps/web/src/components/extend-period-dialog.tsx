"use client";

// Stretching the week under way into two weeks.
//
// Cristian's weeks run Friday to Thursday. A few days in, it can become clear
// that this one has to cover a fortnight — so the period keeps its start, its
// end moves out by a week, and a second week's budget is added on top of
// whatever is already there (including anything carried over at the start,
// which is left exactly as it was: it describes what came IN).
//
// This is ONE-WAY. Nothing walks a fortnight back to a week — not the UI, not
// the security rules — which is why the confirmation is a second, deliberate
// press rather than a checkbox.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import { extendToFortnight, type PeriodBudgetLike } from "@/lib/periods";

export function ExtendPeriodDialog({
  period,
  currency,
  locale,
  /** The household's default budget — what a second week normally costs. */
  defaultAmountCents,
  onConfirm,
  onClose,
}: {
  period: PeriodBudgetLike;
  currency: string;
  locale: string;
  defaultAmountCents: number;
  onConfirm: (endDate: string, newTotalCents: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("extendPeriod");
  const tCommon = useTranslations("expenses");

  const [amount, setAmount] = useState(
    (defaultAmountCents / 100).toFixed(2).replace(".", locale === "es" ? "," : "."),
  );
  /** The second press. Nothing is written until this is true. */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const extension = extendToFortnight(period);
  const addedCents = parseAmountToCents(amount, locale);
  const valid = extension !== null && addedCents !== null;
  const newTotal = period.amountCents + (addedCents ?? 0);

  if (extension === null) return null;

  const field =
    "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-base text-ink outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[440px] flex-col gap-3.5 overflow-y-auto rounded-t-[24px] border border-line bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[24px]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">{t("title")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {/* The dates, before and after, because that is the actual change. */}
        <div className="flex flex-col gap-2 rounded-[14px] bg-fill px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-ink-2">{t("endsNow")}</span>
            <span className="text-[13px] font-semibold text-ink-2 line-through">
              {formatLongDate(period.endDate, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold text-ink">
              {t("endsAfter")}
            </span>
            <span className="text-[13.5px] font-bold text-ink">
              {formatLongDate(extension.endDate, locale)}
            </span>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("addAmount")}</span>
          <input
            autoFocus
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
            }}
            inputMode="decimal"
            className={`${field} tnum`}
          />
          <span className="text-[11.5px] text-ink-3">{t("addAmountHelp")}</span>
        </label>

        {addedCents !== null && (
          <div className="flex items-baseline justify-between gap-3 border-t border-soft pt-3">
            <span className="text-[13px] font-semibold text-ink">
              {t("newTotal")}
            </span>
            <span className="tnum text-[18px] font-bold text-ink">
              {formatCents(newTotal, currency, locale)}
            </span>
          </div>
        )}

        {/* Second press. The warning only appears once the first one is in, so
            it reads as an answer to what was just asked. */}
        {confirming && (
          <p
            className="rounded-[12px] px-3 py-2.5 text-[12.5px] font-semibold leading-snug"
            style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}
          >
            {t("noWayBack")}
          </p>
        )}

        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            if (!confirming) {
              setConfirming(true);
              return;
            }
            onConfirm(extension.endDate, newTotal);
          }}
          className="mt-1 rounded-full py-3 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: confirming ? "var(--warn-text)" : "var(--accent)" }}
        >
          {confirming ? t("confirm") : t("extend")}
        </button>
      </div>
    </div>
  );
}
