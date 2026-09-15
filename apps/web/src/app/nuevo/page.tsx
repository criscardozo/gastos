"use client";

// Quick entry — the phone's primary screen, mirroring the iOS app: remaining
// pill, hero amount on the native decimal keypad, AUD|USD switch, category
// circles, note and date. Desktop keeps the inline add row in /gastos; this
// route stays usable there too, just centred.
//
// No new business logic: amounts go through the same helpers the rest of the
// app uses.

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { useAppError } from "@/components/app-error";
import { Icon } from "@/components/ui/icon";
import { MAX_NOTE_CHARACTERS } from "@/lib/limits";
import { getFirebaseClient } from "@/lib/firebase/client";
import { addExpense } from "@/lib/firebase/mutations";
import { canAddExpense } from "@/lib/period-gate";
import { useExpensesRange } from "@/lib/firebase/hooks";
import {
  categoryCircleBg,
  categoryColor,
  countsToBudget,
} from "@/lib/categories";
import {
  formatCents,
  parseAmountToCents,
} from "@/lib/money";
import { budgetState, containsDate } from "@/lib/periods";
import { formatShortDate } from "@/lib/dates";
import { stateBarColor } from "@/components/ui/progress-bar";

export default function QuickEntryPage() {
  const t = useTranslations("expenses");
  const tDash = useTranslations("dashboard");
  const tCat = useTranslations("categories");
  const tEntry = useTranslations("quickEntry");
  const { locale } = useLocale();
  const { write } = useAppError();
  const { user } = useAuth();
  const { household, currentPeriod, today, deferredStart, openStartPeriod } = useHousehold();

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Live totals for the remaining pill (bounded to the current period).
  const { expenses } = useExpensesRange(
    household?.id ?? null,
    currentPeriod?.startDate ?? null,
    currentPeriod?.endDate ?? null,
  );

  const categories = useMemo(() => {
    if (household === null) return [];
    return Object.entries(household.categories)
      .map(([id, def]) => ({
        id,
        def,
        label: def.key !== undefined ? tCat(def.key) : (def.name ?? id),
      }))
      .sort((a, b) => a.def.sortOrder - b.def.sortOrder);
  }, [household, tCat]);

  if (household === null || user === null) return null;

  const effectiveCategoryId =
    categoryId !== null && household.categories[categoryId] !== undefined
      ? categoryId
      : (categories[0]?.id ?? null);
  const effectiveDate = date !== "" ? date : (today ?? "");

  const audCents = parseAmountToCents(amount, locale);
  const canSave =
    audCents !== null && effectiveCategoryId !== null && effectiveDate !== "";

  /* Remaining in the current period, shown in both currencies. */
  const spent = expenses
    .filter(
      (e) =>
        currentPeriod !== null &&
        containsDate(currentPeriod, e.date) &&
        // Categories opted out of the budget don't move the remaining figure.
        countsToBudget(household.categories[e.categoryId]),
    )
    .reduce((acc, e) => acc + e.amountCents, 0);
  const budget = currentPeriod?.amountCents ?? 0;
  const remaining = budget - spent;
  const state = budgetState(spent, budget);

  // Not awaited on purpose: Firestore only resolves a write once the server
  // acknowledges it, so awaiting would leave this form frozen — amount still
  // typed in, button disabled — for as long as the phone is offline, even
  // though the expense is already saved locally and showing in the list. The
  // second tap that would follow is how you end up with two of them.
  const save = () => {
    const fb = getFirebaseClient();
    // Refused while the period under way has not been started — see
    // lib/period-gate.ts and the same guard on the Gastos screen.
    if (!canAddExpense({ currentPeriod, deferredStart })) {
      openStartPeriod();
      return;
    }
    if (fb === null || !canSave || audCents === null) return;
    write(
      addExpense(fb.db, household.id, user.uid, {
        amountCents: audCents,
        categoryId: effectiveCategoryId,
        note: note.trim(),
        date: effectiveDate,
      }),
    );
    setAmount("");
    setNote("");
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
    amountRef.current?.focus();
  };

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4">
      {/* Header + remaining pill (both currencies, active one first) */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-bold text-ink">
          {tDash("newExpense")}
        </h1>
        {currentPeriod !== null && (
          <div
            className="flex flex-none items-center gap-2 rounded-full px-3 py-1.5"
            style={{ background: "var(--fill)" }}
          >
            <span
              className="h-[7px] w-[7px] flex-none rounded-full"
              style={{ background: stateBarColor(state) }}
            />
            <div className="flex flex-col leading-tight">
              <span className="tnum whitespace-nowrap text-[12.5px] font-bold text-ink">
                {tDash("remaining")}{" "}
                {formatCents(remaining, household.currency, locale)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Hero amount — native decimal keypad */}
      <div className="flex flex-col items-center gap-3 rounded-[18px] border border-line bg-surface px-5 py-6">
        <div className="tnum flex w-full items-baseline justify-center gap-1.5">
          <span className="text-[26px] font-semibold text-ink-3">$</span>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            aria-label={t("amountPlaceholder")}
            // Content-sized so the currency symbol sits next to the digits
            // instead of drifting to the edge of the card.
            size={Math.max(amount.length, 1)}
            style={{ maxWidth: "7ch" }}
            className="w-auto min-w-[1ch] border-none bg-transparent p-0 text-center text-[56px] font-bold leading-none tracking-[-0.03em] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {categories.map((c) => {
          const selected = c.id === effectiveCategoryId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              aria-pressed={selected}
              className="flex w-[68px] flex-none flex-col items-center gap-1.5"
            >
              <span
                className="flex h-[50px] w-[50px] items-center justify-center rounded-full"
                style={{
                  background: categoryCircleBg(c.id, c.def),
                  outline: selected ? "2.5px solid var(--ink)" : "none",
                  outlineOffset: 2,
                }}
              >
                <Icon
                  name={c.def.icon}
                  size={24}
                  style={{ color: categoryColor(c.id, c.def) }}
                />
              </span>
              <span
                className={`w-full truncate text-center text-[11.5px] ${
                  selected ? "font-bold text-ink" : "font-semibold text-ink-2"
                }`}
              >
                {c.label}
              </span>
              {!countsToBudget(c.def) && (
                <span className="-mt-1 text-[9.5px] font-semibold text-ink-3">
                  {tEntry("offBudget")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Note + date */}
      <div className="flex items-center gap-2 rounded-[18px] border border-line bg-surface px-4 py-3">
        <Icon name="edit" size={17} className="flex-none text-ink-3" />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("notePlaceholder")}
          maxLength={MAX_NOTE_CHARACTERS}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[18px] border border-line bg-surface px-4 py-3">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-2">
          <Icon name="calendar_today" size={16} className="text-ink-3" />
          {effectiveDate === today
            ? t("today")
            : formatShortDate(effectiveDate, locale)}
        </span>
        <input
          type="date"
          value={effectiveDate}
          onChange={(e) => {
            if (e.target.value !== "") setDate(e.target.value);
          }}
          aria-label="date"
          className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-1.5 text-[13px] font-semibold text-ink outline-none"
        />
      </div>

      {/* Save */}
      <button
        type="button"
        onClick={() => void save()}
        disabled={!canSave}
        className="flex h-14 items-center justify-center gap-2 rounded-full bg-accent text-[15.5px] font-bold text-white shadow-[0_6px_16px_rgba(255,92,57,.3)] disabled:opacity-50 disabled:shadow-none"
      >
        <Icon name={justSaved ? "check" : "add"} size={20} className="text-white" />
        {justSaved ? tEntry("saved") : t("save")}
      </button>
    </div>
  );
}
