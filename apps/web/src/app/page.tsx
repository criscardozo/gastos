"use client";

// Resumen (design 4a): hero budget state, per-person split, category
// breakdown and the per-period trend chart (plain divs, no chart library).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import { AmountPair } from "@/components/ui/amount-pair";
import { ProgressBar, stateBarColor } from "@/components/ui/progress-bar";
import { StatePill } from "@/components/ui/state-pill";
import {
  primePeriodTotal,
  useExpensesRange,
  usePastPeriodTotals,
} from "@/lib/firebase/hooks";
import type {
  Expense,
  Household,
  PeriodBudget,
} from "@/lib/firebase/converters";
import { budgetState, containsDate, daysBetween } from "@/lib/periods";
import {
  formatApproxUsd,
  formatCents,
  formatCentsCompact,
  formatUsd,
} from "@/lib/money";
import { formatPeriodRange, formatShortDate } from "@/lib/dates";
import { categoryCircleBg, categoryColor, memberColor } from "@/lib/categories";
import { convertCents } from "@/lib/fx";
import {
  effectiveCurrency,
  useActiveCurrency,
  useUsdRate,
} from "@/lib/use-currency";

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

  // Active currency (persisted per user) drives the primary display currency;
  // the daily rate is display-only and degrades to AUD when unavailable.
  const active = useActiveCurrency();
  const usdRate = useUsdRate();
  const effective = effectiveCurrency(active, usdRate);

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
  );

  // While a past period is open its docs are live on the client — seed the
  // aggregation cache so navigating away doesn't cost an extra read.
  useEffect(() => {
    if (household === null || selected === null || isCurrent || expensesLoading) {
      return;
    }
    primePeriodTotal(
      household.id,
      selected.startDate,
      sumCents(expenses.filter((e) => containsDate(selected, e.date))),
    );
  }, [household, selected, isCurrent, expensesLoading, expenses]);

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
  const spent = sumCents(periodExpenses);
  const budget = selected.amountCents;
  const remaining = budget - spent;
  const state = budgetState(spent, budget);
  const daysLeft =
    today !== null && isCurrent
      ? Math.max(daysBetween(today, selected.endDate) + 1, 0)
      : null;

  /* Split between members */
  const members = household.memberIds
    .map((id) => ({ id, profile: household.memberProfiles[id] }))
    .filter((m) => m.profile !== undefined);
  const spentByMember = members.map((m) => ({
    ...m,
    amount: sumCents(periodExpenses.filter((e) => e.createdBy === m.id)),
  }));
  const splitTotal = spent;

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
      return sumCents(expenses.filter((e) => containsDate(p, e.date)));
    }
    if (currentPeriod !== null && p.startDate === currentPeriod.startDate) {
      return sumCents(currentExpenses.filter((e) => containsDate(p, e.date)));
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
          <span className="whitespace-nowrap rounded-full bg-fill px-3 py-[5px] text-[12.5px] font-semibold text-ink-2">
            {t(chipKey, {
              amount: formatCentsCompact(budget, household.currency, locale),
            })}{" "}
            {selected.source === "default" ? (
              <span className="text-ink-3">({t("period.byDefault")})</span>
            ) : (
              <span className="text-accent-strong">
                ({t("period.adjusted").toLowerCase()})
              </span>
            )}
          </span>
        </div>
        <Link
          href="/gastos"
          className="flex items-center gap-2 rounded-full bg-accent px-[18px] py-2.5 shadow-[0_6px_16px_rgba(255,92,57,.3)]"
        >
          <Icon name="add" size={18} className="text-white" />
          <span className="text-sm font-bold text-white">
            {t("dashboard.newExpense")}
          </span>
        </Link>
      </div>

      {/* Hero + split */}
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
              {effective === "USD" && usdRate !== null
                ? formatUsd(convertCents(remaining, usdRate), locale)
                : formatCents(remaining, household.currency, locale)}
            </span>
            {usdRate !== null && (
              <span className="tnum rounded-full bg-fill px-2.5 py-1 text-[13px] font-semibold text-ink-2">
                {effective === "USD"
                  ? formatCents(remaining, household.currency, locale)
                  : formatApproxUsd(convertCents(remaining, usdRate), locale)}
              </span>
            )}
          </div>
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
        </div>

        <div className="flex flex-col gap-3.5 rounded-[22px] border border-line bg-surface px-5 py-5 lg:px-6">
          <span className="text-[13px] font-semibold text-ink-2">
            {t("dashboard.betweenTwo")}
          </span>
          {spentByMember.map((m) => (
            <div key={m.id} className="flex flex-col gap-[7px]">
              <div className="flex items-center gap-2.5">
                <Avatar
                  name={m.profile.displayName}
                  color={m.profile.color}
                  size={26}
                />
                <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">
                  {m.profile.displayName.split(" ")[0]}
                </span>
                <AmountPair
                  audCents={m.amount}
                  usdRate={usdRate}
                  active={effective}
                  locale={locale}
                  currency={household.currency}
                  size="lg"
                />
              </div>
              <div className="h-[7px] rounded bg-soft">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${splitTotal > 0 ? (m.amount / splitTotal) * 100 : 0}%`,
                    background: memberColor(m.profile.color),
                  }}
                />
              </div>
            </div>
          ))}
          {splitTotal > 0 && spentByMember.length === 2 && (
            <span className="text-xs text-ink-3">
              {t("dashboard.splitNote", {
                a: Math.round((spentByMember[0].amount / splitTotal) * 100),
                b: Math.round((spentByMember[1].amount / splitTotal) * 100),
              })}
            </span>
          )}
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
                  <span className="text-[13px] font-semibold text-ink">
                    {categoryLabel(household, b.id)}
                  </span>
                  <AmountPair
                    audCents={b.amount}
                    usdRate={usdRate}
                    active={effective}
                    locale={locale}
                    currency={household.currency}
                  />
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
          <div className="flex flex-1 items-stretch gap-3 overflow-x-auto pt-2 lg:gap-[18px]">
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
    </div>
  );
}
