"use client";

// Everything known about one expense, on clicking its row.
//
// The list is deliberately terse — amount, note, state — so the details that
// only matter when you are asking about a particular expense live here: which
// period it fell into, who added it, when it was created and last touched, and
// what the bank charged for it. Mirrors the iOS detail sheet.

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import type { Expense, Household, PeriodBudget } from "@/lib/firebase/converters";
import { categoryCircleBg, categoryColor, countsToBudget } from "@/lib/categories";
import { containsDate } from "@/lib/periods";
import { formatCents, formatUsd } from "@/lib/money";
import { formatLongDate, formatPeriodRange } from "@/lib/dates";

/** "28 jul, 13:48" — an absolute instant, in the reader's own timezone.
 * 24-hour in Spanish, where "01:56 p. m." is not how anyone writes a time. */
function formatInstant(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "es",
  }).format(date);
}

/** "0,652" — three decimals is where a bank rate stops being noise. */
function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale === "es" ? "es-AR" : "en-AU", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rate);
}

export function ExpenseDetailDialog({
  expense,
  household,
  periods,
  categoryLabel,
  locale,
  onClose,
  onEdit,
  onVerify,
  onDelete,
}: {
  expense: Expense;
  household: Household;
  periods: PeriodBudget[];
  categoryLabel: string;
  locale: string;
  onClose: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("detail");
  const tExpenses = useTranslations("expenses");

  // Escape closes, like any dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const def = household.categories[expense.categoryId];
  const profile = household.memberProfiles[expense.createdBy];
  const period = periods.find((p) => containsDate(p, expense.date));
  const impliedRate =
    expense.verified && expense.usdCents !== null && expense.amountCents > 0
      ? expense.usdCents / expense.amountCents
      : null;
  const created = expense.createdAt?.toDate() ?? null;
  const updated = expense.updatedAt?.toDate() ?? null;
  // Only worth a row when it actually differs from the creation.
  const edited =
    created !== null &&
    updated !== null &&
    Math.abs(updated.getTime() - created.getTime()) > 60_000
      ? updated
      : null;

  const facts: { label: string; value: string }[] = [
    { label: t("date"), value: formatLongDate(expense.date, locale) },
    ...(period !== undefined
      ? [
          {
            label: t("period"),
            value: formatPeriodRange(
              period.startDate,
              period.endDate,
              locale,
              "short",
            ),
          },
        ]
      : []),
    ...(created !== null
      ? [{ label: t("created"), value: formatInstant(created, locale) }]
      : []),
    ...(edited !== null
      ? [{ label: t("updated"), value: formatInstant(edited, locale) }]
      : []),
  ];

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
        className="flex max-h-[90vh] w-full max-w-[440px] flex-col overflow-y-auto rounded-t-[24px] border border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:rounded-[24px]"
      >
        {/* Hero */}
        <div className="flex flex-col items-center gap-2.5 px-5 pb-4 pt-6">
          <div
            className="flex h-[54px] w-[54px] items-center justify-center rounded-full"
            style={{
              background: def
                ? categoryCircleBg(expense.categoryId, def)
                : "var(--fill)",
            }}
          >
            <Icon
              name={def?.icon ?? "more_horiz"}
              size={26}
              style={{
                color: def
                  ? categoryColor(expense.categoryId, def)
                  : "var(--ink-secondary)",
              }}
            />
          </div>
          <span className="tnum text-[34px] font-bold leading-none tracking-[-0.03em] text-ink">
            {formatCents(expense.amountCents, household.currency, locale)}
          </span>
          {expense.note !== "" && (
            <span className="text-center text-[15px] font-semibold text-ink-2">
              {expense.note}
            </span>
          )}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="rounded-full bg-fill px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
              {categoryLabel}
            </span>
            {/* Spending that doesn't eat the period budget is worth saying out
                loud: it explains a total that looks too low. */}
            {def !== undefined && !countsToBudget(def) && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12.5px] font-semibold text-accent-strong">
                {t("offBudget")}
              </span>
            )}
            {expense.pendingWrite && (
              <span className="flex items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[12.5px] font-semibold text-ink-3">
                <Icon name="cloud_off" size={13} className="text-ink-3" />
                {tExpenses("pending")}
              </span>
            )}
          </div>
        </div>

        {/* Verification */}
        <div className="mx-5 flex items-center gap-3 rounded-[16px] border border-line px-4 py-3.5">
          <Icon
            name={expense.verified ? "check_circle" : "error"}
            size={20}
            style={{
              color: expense.verified ? "var(--good-text)" : "var(--info-text)",
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14.5px] font-semibold text-ink">
              {tExpenses(expense.verified ? "verified" : "unverified")}
            </span>
            <span className="tnum text-[12.5px] font-semibold text-ink-3">
              {expense.verified && expense.usdCents !== null
                ? `${formatUsd(expense.usdCents, locale)}${
                    impliedRate !== null
                      ? ` · ${t("rate", { rate: formatRate(impliedRate, locale) })}`
                      : ""
                  }`
                : t("unverifiedHint")}
            </span>
          </div>
          <button
            type="button"
            onClick={onVerify}
            className="flex-none text-[13px] font-bold text-accent-strong"
          >
            {tExpenses("markVerified")}
          </button>
        </div>

        {/* Facts */}
        <div className="mx-5 mt-3 flex flex-col divide-y divide-soft rounded-[16px] border border-line px-4">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-baseline justify-between gap-4 py-3"
            >
              <span className="text-[13.5px] text-ink-2">{fact.label}</span>
              <span className="text-right text-[13.5px] font-semibold text-ink">
                {fact.value}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-[13.5px] text-ink-2">{t("createdBy")}</span>
            <span className="flex items-center gap-2">
              {profile !== undefined && (
                <Avatar name={profile.displayName} color={profile.color} size={20} />
              )}
              <span className="text-[13.5px] font-semibold text-ink">
                {profile?.displayName ?? t("unknownMember")}
              </span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <button
            type="button"
            onClick={onDelete}
            className="text-[13.5px] font-semibold text-over-text"
          >
            {tExpenses("delete")}
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-pill bg-surface px-4 py-2 text-[13px] font-bold text-ink"
            >
              {tExpenses("cancel")}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-bold text-white"
            >
              <Icon name="edit" size={15} className="text-white" />
              {tExpenses("edit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
