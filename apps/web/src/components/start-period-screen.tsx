"use client";

// Starting a period: the first thing seen inside a freshly materialized one.
//
// Full screen and NOT dismissable on purpose. It used to be a bottom sheet you
// could click away, and clicking it away silently kept the default budget — the
// decision looked optional when it is the one thing the screen exists to ask.
// The only ways out are the two answers:
//
//   • Repeat the usual budget, optionally carrying whatever the last period
//     left over (the amount is on the row, so "how much was left?" is not a
//     separate trip to another screen).
//   • Set a different amount for this period alone.
//
// It is also reachable from Ajustes, for the period already under way. Opened
// that way it CAN be closed, because nobody was asked anything. Mirrors the iOS
// NewPeriodScreen.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { AmountInput } from "@/components/ui/amount-input";
import { parseBudgetAmount } from "@/components/budget-amount-field";
import { getFirebaseClient } from "@/lib/firebase/client";
import { updatePeriodAmount } from "@/lib/firebase/mutations";
import { fetchPeriodSpent } from "@/lib/firebase/hooks";
import { allCategoriesCount, budgetCategoryIds } from "@/lib/categories";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatPeriodRange } from "@/lib/dates";
import type { PeriodBudget } from "@/lib/firebase/converters";

export function StartPeriodScreen({
  period,
  manual,
}: {
  period: PeriodBudget;
  /** Opened by hand from Ajustes rather than by a period starting. */
  manual: boolean;
}) {
  const t = useTranslations("newPeriod");
  const { locale } = useLocale();
  const { household, periods, acknowledgeNewPeriod } = useHousehold();

  const [includeRollover, setIncludeRollover] = useState(
    household?.defaultBudget.rollover === true,
  );
  const [leftover, setLeftover] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");

  const defaultAmount = household?.defaultBudget.amountCents ?? 0;
  const weekly = period.period === "weekly";

  /* What the period before this one left over — negative when it was
     overspent. One server-side sum, so one read. */
  const householdId = household?.id ?? null;
  const previous = periods[periods.findIndex((p) => p.startDate === period.startDate) - 1];
  const previousStart = previous?.startDate ?? null;
  const previousEnd = previous?.endDate ?? null;
  const previousAmount = previous?.amountCents ?? null;
  useEffect(() => {
    const fb = getFirebaseClient();
    if (
      fb === null ||
      householdId === null ||
      household === null ||
      previousStart === null ||
      previousEnd === null ||
      previousAmount === null
    ) {
      return;
    }
    let cancelled = false;
    const categoryIds = allCategoriesCount(household.categories)
      ? null
      : budgetCategoryIds(household.categories);
    fetchPeriodSpent(
      fb.db,
      householdId,
      { startDate: previousStart, endDate: previousEnd },
      categoryIds,
    )
      .then((spent) => {
        if (!cancelled) setLeftover(previousAmount - spent);
      })
      .catch(() => {
        // Offline or denied: no figure, so no checkbox — never a guess.
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, household, previousStart, previousEnd, previousAmount]);

  if (household === null) return null;

  /* What "repeat" would set. Never below 1: the rules require a positive
     budget, so a deficit can empty the envelope but not invert it. */
  const repeatAmount =
    includeRollover && leftover !== null
      ? Math.max(1, defaultAmount + leftover)
      : defaultAmount;

  const typed = parseBudgetAmount(amount, locale);

  // Not awaited on purpose. Firestore resolves a write only once the server
  // acknowledges it, and this screen cannot be dismissed — awaiting would trap
  // whoever answers it offline, on the one screen with no way out, while the
  // write sits queued and applied locally.
  const confirm = (amountCents: number, rolloverCents: number) => {
    const fb = getFirebaseClient();
    if (fb !== null && amountCents > 0) {
      // Materialization may already have written exactly this; a write that
      // changes nothing would only flip `source` to "custom" for no reason.
      if (
        amountCents !== period.amountCents ||
        rolloverCents !== period.rolloverCents
      ) {
        void updatePeriodAmount(
          fb.db,
          household.id,
          period.startDate,
          amountCents,
          rolloverCents,
        );
      }
    }
    acknowledgeNewPeriod();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-bg px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))]">
      <div className="flex w-full max-w-[420px] flex-1 flex-col">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[24px] font-bold text-ink">
            {weekly ? t("titleWeekly") : t("titleFortnightly")}
          </span>
          <span className="text-sm text-ink-2">
            {formatPeriodRange(period.startDate, period.endDate, locale)}
          </span>
          <span className="text-[13.5px] text-ink-3">{t("question")}</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
          {editing ? (
            <AmountInput value={amount} onChange={setAmount} fontSize={44} />
          ) : (
            <>
              <span className="tnum text-[44px] font-bold leading-none tracking-[-0.03em] text-ink">
                {formatCents(repeatAmount, household.currency, locale)}
              </span>
              {includeRollover && leftover !== null && leftover !== 0 ? (
                <span className="text-center text-[12.5px] font-semibold text-ink-3">
                  {t("breakdown", {
                    base: formatCentsCompact(
                      defaultAmount,
                      household.currency,
                      locale,
                    ),
                    carried: formatCentsCompact(
                      Math.abs(leftover),
                      household.currency,
                      locale,
                    ),
                  })}
                </span>
              ) : (
                <span className="rounded-full bg-good-bg px-[11px] py-1 text-[11.5px] font-bold text-good-text">
                  {t("defaultBadge")}
                </span>
              )}
            </>
          )}
        </div>

        {/* The leftover, with its figure on the row. A deficit says so rather
            than pretending it is a bonus. */}
        {!editing && leftover !== null && leftover !== 0 && (
          <button
            type="button"
            onClick={() => setIncludeRollover(!includeRollover)}
            className={`mb-3.5 flex items-center gap-3 rounded-[18px] border bg-surface px-4 py-3.5 text-left ${
              includeRollover ? "border-accent" : "border-line"
            }`}
          >
            <Icon
              name={includeRollover ? "check_box" : "check_box_outline_blank"}
              size={22}
              style={{
                color: includeRollover ? "var(--accent)" : "var(--ink-tertiary)",
              }}
            />
            <span className="flex flex-col">
              <span className="text-[14.5px] font-semibold text-ink">
                {t(leftover >= 0 ? "includeLeftover" : "includeDeficit")}
              </span>
              <span
                className="tnum text-[12.5px] font-semibold"
                style={{
                  color: leftover >= 0 ? "var(--good-text)" : "var(--over)",
                }}
              >
                {formatCents(Math.abs(leftover), household.currency, locale)}
              </span>
            </span>
          </button>
        )}

        <div className="flex flex-col gap-2.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => confirm(typed ?? 0, 0)}
                disabled={typed === null}
                className="flex h-14 items-center justify-center gap-2 rounded-full bg-accent text-base font-bold text-white shadow-[0_8px_20px_rgba(255,92,57,.35)] disabled:opacity-60"
              >
                <Icon name="check" size={20} className="text-white" />
                {t("customSave")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-12 rounded-full text-sm font-bold text-ink-2"
              >
                {t("back")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  confirm(repeatAmount, includeRollover ? (leftover ?? 0) : 0)
                }
                disabled={repeatAmount <= 0}
                className="flex h-14 items-center justify-center gap-2 rounded-full bg-accent text-base font-bold text-white shadow-[0_8px_20px_rgba(255,92,57,.35)] disabled:opacity-60"
              >
                <Icon name="check" size={20} className="text-white" />
                {t("repeat", {
                  amount: formatCentsCompact(
                    repeatAmount,
                    household.currency,
                    locale,
                  ),
                })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAmount(
                    (defaultAmount / 100).toLocaleString(
                      locale === "es" ? "es-AR" : "en-AU",
                      { maximumFractionDigits: 2, useGrouping: false },
                    ),
                  );
                  setEditing(true);
                }}
                className="h-13 rounded-full bg-accent-soft py-3.5 text-[15px] font-bold text-accent-strong"
              >
                {t("custom")}
              </button>
              {/* Only when nobody was asked anything: the automatic prompt has
                  no way out other than answering it. */}
              {manual && (
                <button
                  type="button"
                  onClick={acknowledgeNewPeriod}
                  className="h-11 text-sm font-semibold text-ink-2"
                >
                  {t("later")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
