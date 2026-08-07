"use client";

// Inicio (design 4a, formerly "Resumen"): hero budget state, the period and
// month spend readouts, category breakdown and the per-period trend chart
// (plain divs, no chart library).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { ProgressBar, stateBarColor } from "@/components/ui/progress-bar";
import { StatePill } from "@/components/ui/state-pill";
import {
  primePeriodTotal,
  useExpensesRange,
  useMonthTotal,
  usePastPeriodTotals,
} from "@/lib/firebase/hooks";
import type {
  Expense,
  Household,
  PeriodBudget,
} from "@/lib/firebase/converters";
import { budgetState, containsDate, daysBetween } from "@/lib/periods";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatPeriodRange, formatShortDate } from "@/lib/dates";
import {
  allCategoriesCount,
  budgetCategoryIds,
  categoryCircleBg,
  categoryColor,
  countsToBudget,
} from "@/lib/categories";

function useCategoryLabel() {
  const t = useTranslations("categories");
  return (household: Household, categoryId: string): string => {
    const def = household.categories[categoryId];
    // Deleted category: readable fallback, never the raw doc id.
    if (def === undefined) return t("deleted");
    return def.key !== undefined ? t(def.key) : (def.name ?? t("deleted"));
  };
}

function sumCents(expenses: Expense[]): number {
  return expenses.reduce((acc, e) => acc + e.amountCents, 0);
}

export default function DashboardPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { household, periods, currentPeriod, today } = useHousehold();
  const categoryLabel = useCategoryLabel();

  // Budget maths only sees categories flagged as counting. `null` means every
  // category counts, which keeps the unfiltered (index-free) aggregation.
  const budgetCategories = useMemo(
    () =>
      household === null || allCategoriesCount(household.categories)
        ? null
        : budgetCategoryIds(household.categories),
    [household],
  );
  const inBudget = (e: Expense): boolean =>
    budgetCategories === null || budgetCategories.includes(e.categoryId);

  const [selectedStart, setSelectedStart] = useState<string | null>(null);

  // Selected period (defaults to the current one). Computed before the
  // early returns because the listeners below key on it.
  const fallback = currentPeriod ?? periods[periods.length - 1] ?? null;
  const selected =
    (selectedStart !== null
      ? periods.find((p) => p.startDate === selectedStart)
      : undefined) ?? fallback;
  const isCurrent =
    currentPeriod !== null &&
    selected !== null &&
    selected.startDate === currentPeriod.startDate;

  // Live listener bounded to the SELECTED period (hero, split, breakdown).
  const { expenses, loading: expensesLoading } = useExpensesRange(
    household?.id ?? null,
    selected?.startDate ?? null,
    selected?.endDate ?? null,
  );

  // The CURRENT period always keeps a live listener for the trend bar; when
  // the selected period IS the current one, the listener above covers it
  // (passing null here avoids a duplicate).
  const { expenses: currentExpenses } = useExpensesRange(
    isCurrent ? null : (household?.id ?? null),
    currentPeriod?.startDate ?? null,
    currentPeriod?.endDate ?? null,
  );

  // Past (non-current, non-selected) trend periods come from one sum()
  // aggregation each (1 read) instead of streaming their expense docs.
  const pastTrendPeriods = periods
    .slice(-6)
    .filter(
      (p) =>
        p.startDate !== currentPeriod?.startDate &&
        p.startDate !== selected?.startDate,
    );
  const pastTotals = usePastPeriodTotals(
    household?.id ?? null,
    pastTrendPeriods,
    budgetCategories,
  );

  // Calendar-month spend — one server-side sum, independent of where the
  // weekly/fortnightly boundaries happen to fall.
  const {
    total: monthTotal,
    status: monthStatus,
    range: monthRange,
  } = useMonthTotal(
    household?.id ?? null,
    today,
    budgetCategories,
  );

  // While a past period is open its docs are live on the client — seed the
  // aggregation cache so navigating away doesn't cost an extra read.
  useEffect(() => {
    if (household === null || selected === null || isCurrent || expensesLoading) {
      return;
    }
    primePeriodTotal(
      household.id,
      selected,
      sumCents(
        expenses.filter((e) => containsDate(selected, e.date) && inBudget(e)),
      ),
      budgetCategories,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, selected, isCurrent, expensesLoading, expenses, budgetCategories]);

  if (household === null) return null;

  if (selected === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-ink">
          {t("dashboard.title")}
        </h1>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <Icon name="flag" size={24} className="text-ink-3" />
          <div className="flex flex-col gap-px">
            <span className="text-[13.5px] font-bold text-ink">
              {t("dashboard.noPeriod")}
            </span>
            <span className="text-xs text-ink-3">
              {t("dashboard.noPeriodHint", {
                date: formatShortDate(
                  household.defaultBudget.anchorDate,
                  locale,
                ),
              })}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const selectedIndex = periods.findIndex(
    (p) => p.startDate === selected.startDate,
  );
  const maxIndex = fallback !== null
    ? periods.findIndex((p) => p.startDate === fallback.startDate)
    : periods.length - 1;

  const periodExpenses = expenses.filter((e) => containsDate(selected, e.date));
  // Excluded categories are still listed below; they just don't consume the
  // period's budget.
  const spent = sumCents(periodExpenses.filter(inBudget));
  const budget = selected.amountCents;
  const remaining = budget - spent;
  const state = budgetState(spent, budget);
  const daysLeft =
    today !== null && isCurrent
      ? Math.max(daysBetween(today, selected.endDate) + 1, 0)
      : null;

  /* Category breakdown */
  const byCategory = new Map<string, number>();
  for (const e of periodExpenses) {
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + e.amountCents);
  }
  const breakdown = [...byCategory.entries()]
    .map(([id, amount]) => ({ id, amount, def: household.categories[id] }))
    .sort((a, b) => b.amount - a.amount);
  const maxCategory = breakdown[0]?.amount ?? 0;

  /* Trend: last up-to-6 loaded periods. Selected + current come from their
     live listeners; every other (past) period from the aggregation cache. */
  const spentForTrend = (p: PeriodBudget): number => {
    if (p.startDate === selected.startDate) {
      return sumCents(
        expenses.filter((e) => containsDate(p, e.date) && inBudget(e)),
      );
    }
    if (currentPeriod !== null && p.startDate === currentPeriod.startDate) {
      return sumCents(
        currentExpenses.filter((e) => containsDate(p, e.date) && inBudget(e)),
      );
    }
    return pastTotals[p.startDate] ?? 0;
  };
  const trendPeriods = periods.slice(-6);
  const trend = trendPeriods.map((p) => ({
    period: p,
    spent: spentForTrend(p),
  }));
  const trendScale = Math.max(
    ...trend.map((x) => Math.max(x.spent, x.period.amountCents)),
    1,
  );

  const chipKey =
    selected.period === "weekly" ? "period.weeklyAmount" : "period.fortnightlyAmount";

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-3.5 gap-y-2">
          <h1 className="text-[22px] font-bold text-ink">
            {t("dashboard.title")}
          </h1>
          <div className="flex items-center gap-0.5 rounded-full border border-pill bg-surface px-2 py-[5px]">
            <button
              type="button"
              aria-label="previous period"
              disabled={selectedIndex <= 0}
              onClick={() =>
                setSelectedStart(periods[selectedIndex - 1].startDate)
              }
              className="p-0.5 disabled:cursor-default"
            >
              <Icon
                name="chevron_left"
                size={18}
                className={selectedIndex > 0 ? "text-ink-2" : "text-ink-3 opacity-50"}
              />
            </button>
            <span className="whitespace-nowrap px-1.5 text-[13.5px] font-semibold text-ink">
              {formatPeriodRange(selected.startDate, selected.endDate, locale)}
            </span>
            <button
              type="button"
              aria-label="next period"
              disabled={selectedIndex >= maxIndex}
              onClick={() =>
                setSelectedStart(periods[selectedIndex + 1].startDate)
              }
              className="p-0.5 disabled:cursor-default"
            >
              <Icon
                name="chevron_right"
                size={18}
                className={
                  selectedIndex < maxIndex ? "text-ink-2" : "text-ink-3 opacity-50"
                }
              />
            </button>
          </div>
        </div>
        <Link
          href="/gastos"
          className="hidden items-center gap-2 rounded-full bg-accent px-[18px] py-2.5 shadow-[0_6px_16px_rgba(255,92,57,.3)] lg:flex"
        >
          <Icon name="add" size={18} className="text-white" />
          <span className="text-sm font-bold text-white">
            {t("dashboard.newExpense")}
          </span>
        </Link>
      </div>

      {/* Hero + the two spend readouts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-[13px] rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6 lg:py-[22px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-2">
              {t("dashboard.remaining")}
            </span>
            <StatePill state={state} />
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className="tnum text-[40px] font-bold leading-none tracking-[-0.03em] sm:text-[54px]"
              style={{ color: state === "over" ? "var(--over)" : "var(--ink)" }}
            >
              {formatCents(remaining, household.currency, locale)}
            </span>
          </div>
          {/* Say where the budget came from when part of it was carried in —
              otherwise "de $1.020" looks like a typo for the usual $900. */}
          {selected.rolloverCents !== 0 && (
            <span className="text-[11.5px] text-ink-3">
              {t(
                selected.rolloverCents > 0
                  ? "dashboard.carriedOver"
                  : "dashboard.carriedDeficit",
                {
                  amount: formatCents(
                    Math.abs(selected.rolloverCents),
                    household.currency,
                    locale,
                  ),
                },
              )}
            </span>
          )}
          <ProgressBar fraction={budget > 0 ? spent / budget : 0} state={state} />
          <div className="tnum flex justify-between text-[13.5px] text-ink-2">
            <span>
              {t.rich("dashboard.spentOf", {
                spent: formatCents(spent, household.currency, locale),
                budget: formatCentsCompact(budget, household.currency, locale),
                strong: (chunks) => (
                  <strong className="text-ink">{chunks}</strong>
                ),
              })}
            </span>
            <span>
              {daysLeft !== null
                ? t.rich("dashboard.daysLeft", {
                    count: daysLeft,
                    strong: (chunks) => (
                      <strong className="text-ink">{chunks}</strong>
                    ),
                  })
                : t("dashboard.periodEnded")}
            </span>
          </div>

          {/* Which budget this period is running on. Lives here rather than up
              in the header: it explains the figures right above it. */}
          <div
            className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2"
            style={{
              background:
                selected.source === "custom"
                  ? "var(--accent-soft)"
                  : "var(--fill)",
            }}
          >
            <Icon
              name="savings"
              size={16}
              className={
                selected.source === "custom" ? "text-accent-strong" : "text-ink-3"
              }
            />
            <span className="tnum text-[12.5px] font-semibold text-ink-2">
              {t(chipKey, {
                amount: formatCentsCompact(budget, household.currency, locale),
              })}{" "}
              {selected.source === "default" ? (
                <span className="text-ink-3">({t("period.byDefault")})</span>
              ) : (
                <span className="font-bold text-accent-strong">
                  ({t("period.adjusted").toLowerCase()})
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* How much we've spent this period — the figure asked for at a
              glance, so it gets its own card and its own big number. */}
          <div className="flex flex-col gap-1 rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6">
            <span className="text-[13px] font-semibold text-ink-2">
              {t(
                selected.period === "weekly"
                  ? "dashboard.spentThisWeek"
                  : "dashboard.spentThisFortnight",
              )}
            </span>
            <span
              className="tnum text-[34px] font-bold leading-none tracking-[-0.03em]"
              style={{ color: state === "over" ? "var(--over)" : "var(--ink)" }}
            >
              {formatCents(spent, household.currency, locale)}
            </span>
          </div>

          {/* Same, for the calendar month. */}
          <div className="flex flex-col gap-1 rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6">
            <span className="text-[13px] font-semibold text-ink-2">
              {t("dashboard.spentThisMonth")}
            </span>
            {monthStatus === "error" ? (
              <span className="text-[15px] font-semibold text-ink-3">
                {t("dashboard.monthUnavailable")}
              </span>
            ) : monthTotal === null ? (
              <span className="text-[15px] font-semibold text-ink-3">
                {t("dashboard.loading")}
              </span>
            ) : (
              <>
                <span className="tnum text-[34px] font-bold leading-none tracking-[-0.03em] text-ink">
                  {formatCents(monthTotal, household.currency, locale)}
                </span>
              </>
            )}
            {monthRange !== null && (
              <span className="text-[11.5px] text-ink-3">
                {formatPeriodRange(
                  monthRange.startDate,
                  monthRange.endDate,
                  locale,
                  "short",
                )}
              </span>
            )}
            {/* A period that began in the previous month has its spending split
                across two months, so this figure is not the whole story. */}
            {monthRange !== null &&
              currentPeriod !== null &&
              currentPeriod.startDate < monthRange.startDate && (
                <span className="mt-1 flex items-start gap-1.5 rounded-xl bg-accent-soft px-2.5 py-1.5 text-[11px] font-semibold leading-[1.35] text-accent-strong">
                  <Icon
                    name="info"
                    size={13}
                    className="mt-px flex-none text-accent-strong"
                  />
                  {t("dashboard.periodCrossesMonth", {
                    date: formatShortDate(currentPeriod.startDate, locale),
                  })}
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Category breakdown + trend */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_1.35fr]">
        <div className="flex flex-col gap-1 rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6">
          <span className="mb-2 text-[13px] font-semibold text-ink-2">
            {t("dashboard.byCategory")}
          </span>
          {breakdown.length === 0 && (
            <div className="flex items-center gap-3 py-2">
              <Icon name="receipt_long" size={24} className="text-ink-3" />
              <div className="flex flex-col gap-px">
                <span className="text-[13.5px] font-bold text-ink">
                  {t("empty.noExpensesTitle")}
                </span>
                <span className="text-xs text-ink-3">
                  {t("empty.noExpensesHint")}
                </span>
              </div>
            </div>
          )}
          {breakdown.map((b) => (
            <div key={b.id} className="flex items-center gap-[11px] py-[7px]">
              <div
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
                style={{
                  background: b.def
                    ? categoryCircleBg(b.id, b.def)
                    : "var(--fill)",
                }}
              >
                <Icon
                  name={b.def?.icon ?? "more_horiz"}
                  size={16}
                  style={{
                    color: b.def ? categoryColor(b.id, b.def) : "var(--ink-secondary)",
                  }}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-ink">
                      {categoryLabel(household, b.id)}
                    </span>
                    {/* Spent, but outside the budget — say so, otherwise the
                        numbers here look like they don't add up. */}
                    {!countsToBudget(b.def) && (
                      <span className="flex-none rounded-full bg-fill px-1.5 py-px text-[10px] font-semibold text-ink-3">
                        {t("dashboard.offBudget")}
                      </span>
                    )}
                  </span>
                  <span className="tnum text-[13px] font-semibold text-ink">
                    {formatCents(b.amount, household.currency, locale)}
                  </span>
                </div>
                <div className="h-[5px] overflow-hidden rounded-[3px] bg-soft">
                  <div
                    className="h-full rounded-[3px]"
                    style={{
                      width: `${maxCategory > 0 ? (b.amount / maxCategory) * 100 : 0}%`,
                      background: b.def
                        ? categoryColor(b.id, b.def)
                        : "var(--ink-secondary)",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-ink-2">
              {t("dashboard.trend")}
            </span>
            <span className="text-[11.5px] text-ink-3">
              {t("dashboard.trendHint")}
            </span>
          </div>
          {/* px-1 gives the budget markers their -left-1/-right-1 overhang room:
              without it the last one spills 4px past the edge and the box
              reports as scrollable, showing a scrollbar under bars that fit.
              Real overflow still scrolls (six periods on a phone), just
              without the chrome. */}
          <div className="no-scrollbar flex flex-1 items-stretch gap-3 overflow-x-auto px-1 pt-2 lg:gap-[18px]">
            {trend.map(({ period: p, spent: pSpent }) => {
              const over = pSpent > p.amountCents;
              const isCurrentBar =
                currentPeriod !== null &&
                p.startDate === currentPeriod.startDate;
              const barColor = over
                ? "var(--over)"
                : stateBarColor("comfortable");
              const labelKey =
                p.period === "weekly"
                  ? "period.weeklyAmount"
                  : "period.fortnightlyAmount";
              return (
                <div
                  key={p.startDate}
                  className="flex min-w-[62px] flex-1 flex-col gap-2"
                >
                  <div className="relative flex min-h-[140px] flex-1 items-end">
                    <div
                      className="absolute -left-1 -right-1 h-0 border-t-2 border-dashed"
                      style={{
                        bottom: `${(p.amountCents / trendScale) * 100}%`,
                        borderColor:
                          "color-mix(in srgb, var(--ink) 25%, transparent)",
                      }}
                    />
                    <div
                      className="w-full rounded-t-[10px] rounded-b-[4px]"
                      style={{
                        height: `${(pSpent / trendScale) * 100}%`,
                        background: barColor,
                        opacity: isCurrentBar ? 0.45 : 1,
                        minHeight: pSpent > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                  <div className="flex flex-col items-center gap-px">
                    <span className="tnum text-[12.5px] font-bold text-ink">
                      {formatCentsCompact(pSpent, household.currency, locale)}
                    </span>
                    <span className="whitespace-nowrap text-[11px] font-semibold text-ink-2">
                      {formatPeriodRange(p.startDate, p.endDate, locale, "short")}
                      {isCurrentBar && (
                        <span className="text-ink-3">
                          {" "}
                          · {t("period.inProgress")}
                        </span>
                      )}
                    </span>
                    <span className="tnum whitespace-nowrap text-[10.5px] text-ink-3">
                      {t(labelKey, {
                        amount: formatCentsCompact(
                          p.amountCents,
                          household.currency,
                          locale,
                        ),
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Phone-only floating action button. Sits clear of the 57px tab bar
          (measured) plus the home-indicator inset, within thumb reach, and
          goes straight to quick entry. Hidden from lg up, where the header
          button above takes over. */}
      <Link
        href="/nuevo"
        aria-label={t("dashboard.newExpense")}
        className="fixed right-4 bottom-[calc(57px+1rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent shadow-[0_8px_24px_rgba(255,92,57,.45)] active:scale-95 lg:hidden"
      >
        <Icon name="add" size={26} className="text-white" />
      </Link>
    </div>
  );
}
