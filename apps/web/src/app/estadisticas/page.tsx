"use client";

// Estadísticas: what the ledger says once you stand back from it.
//
// One date-bounded read per range (getDocs, not a listener — this is a page you
// visit, not a screen you live on), then every figure is computed client-side
// in lib/stats.ts. Charts are divs and hand-written SVG: no charting library,
// same rule as the dashboard's trend bars.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

import { useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import { Segmented } from "@/components/ui/segmented";
import {
  BarRow,
  DayBars,
  HeadlineStat,
  PaceChart,
  StatCard,
} from "@/components/charts";
import { getFirebaseClient } from "@/lib/firebase/client";
import { expenseConverter } from "@/lib/firebase/converters";
import { categoryColor } from "@/lib/categories";
import { formatCents, formatCentsCompact, formatUsd } from "@/lib/money";
import { formatPeriodRange, formatShortDate } from "@/lib/dates";
import {
  addDays,
  containsDate,
  daysBetween,
  type PeriodRange,
} from "@/lib/periods";
import {
  biggest as biggestOf,
  byCategory,
  byDay,
  byMember,
  byWeekday,
  cumulative,
  pace as paceLine,
  totals as totalsOf,
  verification,
  type StatExpense,
} from "@/lib/stats";

type RangePreset = "period" | "month" | "quarter" | "custom";

/** How far today's spend is from the even-pace line, in cents. */
function paceGap({
  spent,
  pace,
  asOfIndex,
}: {
  spent: number[];
  pace: number[];
  asOfIndex: number;
}): number {
  const i = Math.min(Math.max(asOfIndex, 0), spent.length - 1);
  return Math.abs((spent[i] ?? 0) - (pace[i] ?? 0));
}

/** First and last day of the calendar month containing `date`. */
function monthRange(date: string): PeriodRange {
  const [year, month] = date.split("-");
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(last).padStart(2, "0")}`,
  };
}

export default function StatsPage() {
  const t = useTranslations("stats");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { household, periods, currentPeriod, today } = useHousehold();

  const [preset, setPreset] = useState<RangePreset>("period");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [state, setState] = useState<{
    rows: StatExpense[];
    loading: boolean;
    failed: boolean;
  }>({ rows: [], loading: true, failed: false });

  const range = useMemo<PeriodRange | null>(() => {
    if (preset === "custom") {
      if (customFrom === "" || customTo === "" || customFrom > customTo) {
        return null;
      }
      return { startDate: customFrom, endDate: customTo };
    }
    if (today === null) return null;
    if (preset === "month") return monthRange(today);
    if (preset === "quarter") {
      return { startDate: addDays(today, -89), endDate: today };
    }
    const p = currentPeriod ?? periods[periods.length - 1] ?? null;
    return p === null ? null : { startDate: p.startDate, endDate: p.endDate };
  }, [preset, today, customFrom, customTo, currentPeriod, periods]);

  /* One bounded read per range. */
  const householdId = household?.id ?? null;
  const from = range?.startDate ?? null;
  const to = range?.endDate ?? null;
  useEffect(() => {
    if (householdId === null || from === null || to === null) {
      setState({ rows: [], loading: false, failed: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    setState({ rows: [], loading: true, failed: false });
    getDocs(
      query(
        collection(fb.db, "households", householdId, "expenses"),
        where("date", ">=", from),
        where("date", "<=", to),
        orderBy("date", "asc"),
      ).withConverter(expenseConverter),
    )
      .then((snap) => {
        if (cancelled) return;
        setState({
          rows: snap.docs.map((d) => d.data()),
          loading: false,
          failed: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ rows: [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, from, to]);

  const rows = state.rows;
  const stats = useMemo(
    () =>
      range === null
        ? null
        : {
            totals: totalsOf(rows, range),
            categories: byCategory(rows),
            days: byDay(rows, range),
            weekdays: byWeekday(rows, range),
            members: byMember(rows),
            checks: verification(rows),
            top: biggestOf(rows, 5),
          },
    [rows, range],
  );

  if (household === null) return null;

  const money = (cents: number) => formatCents(cents, household.currency, locale);
  const compact = (cents: number) =>
    formatCentsCompact(cents, household.currency, locale);
  const catLabel = (id: string): string => {
    const def = household.categories[id];
    if (def === undefined) return tCat("deleted");
    return def.key !== undefined ? tCat(def.key) : (def.name ?? id);
  };
  const weekdayNames = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-AU", {
      weekday: "short",
      // 2026-08-03 is a Monday, so the offset walks Mon→Sun.
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 7, 3 + i))),
  );

  /* The pace comparison only means something inside a period that has a
     budget — a calendar month spans two or three of them. */
  const budgetPeriod =
    preset === "period"
      ? (currentPeriod ?? periods[periods.length - 1] ?? null)
      : null;
  const paceData =
    stats !== null && budgetPeriod !== null && range !== null
      ? {
          spent: cumulative(stats.days).map((d) => d.totalCents),
          pace: paceLine(budgetPeriod.amountCents, stats.days.length),
          budgetCents: budgetPeriod.amountCents,
          // Where "today" falls in the period. A finished period is read to
          // its end; a running one stops at today, since the days after it
          // have not happened rather than been spendless.
          asOfIndex:
            today !== null && containsDate(range, today)
              ? daysBetween(range.startDate, today)
              : stats.days.length - 1,
        }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        {range !== null && (
          <span className="text-[13px] font-semibold text-ink-2">
            {formatPeriodRange(range.startDate, range.endDate, locale, "short")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented<RangePreset>
          ariaLabel={t("range")}
          options={[
            { value: "period", label: t("rangePeriod") },
            { value: "month", label: t("rangeMonth") },
            { value: "quarter", label: t("rangeQuarter") },
            { value: "custom", label: t("rangeCustom") },
          ]}
          value={preset}
          onChange={(next) => {
            if (next === "custom" && customFrom === "" && today !== null) {
              setCustomFrom(addDays(today, -29));
              setCustomTo(today);
            }
            setPreset(next);
          }}
        />
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label={t("from")}
              className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13px] font-semibold text-ink outline-none"
            />
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label={t("to")}
              className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13px] font-semibold text-ink outline-none"
            />
          </div>
        )}
      </div>

      {state.loading && (
        <span className="text-[13px] text-ink-3">{t("loading")}</span>
      )}
      {state.failed && (
        <span className="text-[13px] font-semibold text-over">{t("failed")}</span>
      )}

      {stats !== null && !state.loading && !state.failed && (
        rows.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
            <Icon name="bar_chart" size={24} className="text-ink-3" />
            <div className="flex flex-col gap-px">
              <span className="text-[13.5px] font-bold text-ink">
                {t("emptyTitle")}
              </span>
              <span className="text-xs text-ink-3">{t("emptyHint")}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Headline figures */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <HeadlineStat
                label={t("total")}
                value={money(stats.totals.totalCents)}
                meta={t("expenseCount", { count: stats.totals.count })}
              />
              <HeadlineStat
                label={t("perDay")}
                value={money(stats.totals.perDayCents)}
                meta={t("quietDays", { count: stats.totals.daysWithoutSpending })}
              />
              <HeadlineStat
                label={t("average")}
                value={money(stats.totals.averageCents)}
              />
              <HeadlineStat
                label={t("biggest")}
                value={money(stats.totals.biggest?.amountCents ?? 0)}
                meta={
                  stats.totals.biggest === null
                    ? undefined
                    : stats.totals.biggest.note !== ""
                      ? stats.totals.biggest.note
                      : catLabel(stats.totals.biggest.categoryId)
                }
              />
            </div>

            {/* Pace against the budget */}
            {paceData !== null && (
              <StatCard title={t("paceTitle")} hint={t("paceHint")}>
                <PaceChart
                  spent={paceData.spent}
                  pace={paceData.pace}
                  budgetCents={paceData.budgetCents}
                  asOfIndex={paceData.asOfIndex}
                  overLabel={t("paceOver", {
                    amount: compact(paceGap(paceData)),
                  })}
                  underLabel={t("paceUnder", {
                    amount: compact(paceGap(paceData)),
                  })}
                />
              </StatCard>
            )}

            {/* Day by day */}
            <StatCard title={t("dailyTitle")} hint={t("dailyHint")}>
              <DayBars
                points={stats.days}
                labelFor={(date) => formatShortDate(date, locale)}
                valueFor={money}
              />
              <div className="flex justify-between text-[11px] text-ink-3">
                <span>{formatShortDate(stats.days[0].date, locale)}</span>
                <span>
                  {formatShortDate(
                    stats.days[stats.days.length - 1].date,
                    locale,
                  )}
                </span>
              </div>
            </StatCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Categories */}
              <StatCard title={t("categoriesTitle")}>
                <div className="flex flex-col gap-2.5">
                  {stats.categories.map((slice) => {
                    const def = household.categories[slice.categoryId];
                    return (
                      <BarRow
                        key={slice.categoryId}
                        label={
                          <>
                            <Icon
                              name={def?.icon ?? "more_horiz"}
                              size={14}
                              style={{
                                color: def
                                  ? categoryColor(slice.categoryId, def)
                                  : "var(--ink-secondary)",
                              }}
                            />
                            {catLabel(slice.categoryId)}
                          </>
                        }
                        value={money(slice.totalCents)}
                        meta={`${Math.round(slice.share * 100)}%`}
                        fraction={
                          slice.totalCents /
                          Math.max(stats.categories[0].totalCents, 1)
                        }
                        color={
                          def
                            ? categoryColor(slice.categoryId, def)
                            : "var(--ink-tertiary)"
                        }
                      />
                    );
                  })}
                </div>
              </StatCard>

              {/* Weekdays */}
              <StatCard title={t("weekdayTitle")} hint={t("weekdayHint")}>
                <div className="flex flex-col gap-2.5">
                  {stats.weekdays.map((day) => (
                    <BarRow
                      key={day.weekday}
                      label={weekdayNames[day.weekday]}
                      value={money(day.averageCents)}
                      fraction={
                        day.averageCents /
                        Math.max(
                          ...stats.weekdays.map((d) => d.averageCents),
                          1,
                        )
                      }
                    />
                  ))}
                </div>
              </StatCard>

              {/* Biggest expenses */}
              <StatCard title={t("topTitle")}>
                <div className="flex flex-col divide-y divide-soft">
                  {stats.top.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {e.note !== "" ? e.note : catLabel(e.categoryId)}
                        </span>
                        <span className="text-[11px] text-ink-3">
                          {formatShortDate(e.date, locale)} ·{" "}
                          {catLabel(e.categoryId)}
                        </span>
                      </div>
                      <span className="tnum flex-none text-[13px] font-bold text-ink">
                        {money(e.amountCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </StatCard>

              {/* What the bank has confirmed */}
              <StatCard title={t("verifiedTitle")} hint={t("verifiedHint")}>
                <div className="flex flex-col gap-2.5">
                  <BarRow
                    label={t("verifiedLabel")}
                    value={`${stats.checks.verified}/${
                      stats.checks.verified + stats.checks.unverified
                    }`}
                    fraction={
                      stats.checks.verified /
                      Math.max(
                        stats.checks.verified + stats.checks.unverified,
                        1,
                      )
                    }
                    color="var(--good)"
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2 pt-0.5">
                    <span className="text-[12.5px] text-ink-2">
                      {t("bankCharged")}
                    </span>
                    <span className="tnum text-[15px] font-bold text-ink">
                      {formatUsd(stats.checks.usdCents, locale)}
                    </span>
                  </div>
                  {stats.checks.rate !== null && (
                    <span className="text-[11.5px] text-ink-3">
                      {t("learnedRate", {
                        rate: new Intl.NumberFormat(
                          locale === "es" ? "es-AR" : "en-AU",
                          {
                            minimumFractionDigits: 3,
                            maximumFractionDigits: 3,
                          },
                        ).format(stats.checks.rate),
                        aud: compact(stats.checks.verifiedAudCents),
                      })}
                    </span>
                  )}
                </div>
              </StatCard>

              {/* Who entered what — only worth a card when both did */}
              {stats.members.length > 1 && (
                <StatCard title={t("membersTitle")} hint={t("membersHint")}>
                  <div className="flex flex-col gap-2.5">
                    {stats.members.map((m) => {
                      const profile = household.memberProfiles[m.uid];
                      return (
                        <BarRow
                          key={m.uid}
                          label={
                            <>
                              {profile !== undefined && (
                                <Avatar
                                  name={profile.displayName}
                                  color={profile.color}
                                  size={18}
                                />
                              )}
                              {profile?.displayName ?? t("someone")}
                            </>
                          }
                          value={money(m.totalCents)}
                          meta={`${Math.round(m.share * 100)}%`}
                          fraction={
                            m.totalCents /
                            Math.max(stats.members[0].totalCents, 1)
                          }
                          color={profile?.color ?? "var(--accent)"}
                        />
                      );
                    })}
                  </div>
                </StatCard>
              )}
            </div>

            {/* Period-over-period, from the periods already loaded */}
            {periods.length > 1 && (
              <StatCard title={t("periodsTitle")} hint={t("periodsHint")}>
                <div className="flex flex-col gap-2.5">
                  {[...periods]
                    .slice(-6)
                    .reverse()
                    .map((p) => {
                      const spent = rows
                        .filter((e) => containsDate(p, e.date))
                        .reduce((sum, e) => sum + e.amountCents, 0);
                      const covered =
                        range !== null &&
                        p.startDate >= range.startDate &&
                        p.endDate <= range.endDate;
                      return (
                        <BarRow
                          key={p.startDate}
                          label={formatPeriodRange(
                            p.startDate,
                            p.endDate,
                            locale,
                            "short",
                          )}
                          value={covered ? money(spent) : "—"}
                          meta={
                            covered
                              ? `${Math.round(
                                  (spent / Math.max(p.amountCents, 1)) * 100,
                                )}%`
                              : t("outsideRange")
                          }
                          fraction={
                            covered ? spent / Math.max(p.amountCents, 1) : 0
                          }
                          color={
                            spent > p.amountCents
                              ? "var(--over)"
                              : "var(--accent)"
                          }
                        />
                      );
                    })}
                </div>
              </StatCard>
            )}
          </div>
        )
      )}
    </div>
  );
}
