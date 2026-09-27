"use client";

// Starting the next period today instead of waiting for the current one to end.
//
// Asked for on a Sunday: the week ran Monday to Sunday and the household
// wanted the new one to start that day. The week under way ends yesterday, the
// new one runs from today to where the following period would have ended, and
// the usual weekday comes back after it (startNextEarly in lib/periods.ts).
// Nothing asks about money here: the new period is created unanswered, so the
// start-period screen comes up next and asks exactly what it always asks.

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { capitaliseFirst, formatLongDate, formatPeriodRange } from "@/lib/dates";
import { daysBetween, type EarlyStart } from "@/lib/periods";
import { DIALOG_SHELL } from "@/components/ui/dialog-shell";

export function StartEarlyDialog({
  currentEndDate,
  early,
  locale,
  onConfirm,
  onClose,
}: {
  currentEndDate: string;
  early: EarlyStart;
  locale: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("startEarly");
  const tCommon = useTranslations("expenses");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const days = daysBetween(early.next.startDate, early.next.endDate) + 1;

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
        className={DIALOG_SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("title")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {/* The dates, before and after, because that is the actual change. */}
        <div className="flex flex-col gap-2 rounded-[14px] bg-fill px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-ink-2">{t("endsNow")}</span>
            <span className="text-[13px] font-semibold text-ink-2 line-through">
              {capitaliseFirst(formatLongDate(currentEndDate, locale))}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold text-ink">{t("endsAfter")}</span>
            <span className="text-[13.5px] font-bold text-ink">
              {capitaliseFirst(formatLongDate(early.endDate, locale))}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-soft pt-2">
            <span className="text-[12px] font-semibold text-ink">{t("nextRuns")}</span>
            <span className="tnum text-[13.5px] font-bold text-ink">
              {formatPeriodRange(early.next.startDate, early.next.endDate, locale)}
              <span className="font-semibold text-ink-2"> · {t("days", { count: days })}</span>
            </span>
          </div>
        </div>

        <p className="text-[12.5px] leading-snug text-ink-2">{t("note")}</p>

        <button
          type="button"
          onClick={onConfirm}
          className="mt-1 rounded-full bg-accent py-3 text-sm font-bold text-white primary-disabled"
        >
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}
