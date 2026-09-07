"use client";

// Gastos (design 4b): filters, inline dashed add row, day-grouped or flat
// list, inline edit and delete per row.

import {
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { useAppError } from "@/components/app-error";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { BankChargesPanel } from "@/components/bank-charges-panel";
import { ExpenseDetailDialog } from "@/components/expense-detail-dialog";
import { useBankCharges, useExpensesRange } from "@/lib/firebase/hooks";
import { getFirebaseClient } from "@/lib/firebase/client";
import { monthSelection, resolveSelection } from "@/lib/period-selection";
import {
  addExpense,
  deleteExpense,
  setExpenseVerification,
  updateExpense,
  type ExpenseInput,
} from "@/lib/firebase/mutations";
import {
  buildAmountFields,
  ExpenseFormFields,
  FilterPill,
  PillSelect,
  useSortedCategories,
  type FormState,
  type VerificationFilter,
} from "./pieces";
import { visibleExpenses } from "@/lib/expense-list";
import { learnRate } from "@/lib/bank-match";
import { claimsOfOneRule } from "@/lib/recurring";
import { RecurringPrompt } from "@/components/recurring-prompt";
import { RecurringRuleDialog } from "@/components/recurring-rule-dialog";
import { useRecurringRules, useServices } from "@/lib/firebase/hooks";
import { isPending } from "@/lib/bank-charges";
import {
  addRecurringRule,
  fileRecurringExpense,
  undoRecurringExpense,
  chargeIdFromAutoExpense,
} from "@/lib/firebase/mutations";
import type { Expense, Household } from "@/lib/firebase/converters";
import { categoryCircleBg, categoryColor } from "@/lib/categories";
import {
  formatCents,
  formatUsd,
  parseAmountToCents,
} from "@/lib/money";
import {
  formatDayHeading,
  formatMonthLabel,
  formatPeriodRange,
  formatShortDate,
} from "@/lib/dates";
import {
  addDays,
  recentMonths,
} from "@/lib/periods";
import { buildExpensesCsv, downloadCsv } from "@/lib/export/csv";

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ExpensesPage() {
  const t = useTranslations("expenses");
  const tEmpty = useTranslations("empty");
  const tDash = useTranslations("dashboard");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { write } = useAppError();
  const { user } = useAuth();
  const { household, periods, currentPeriod, today } = useHousehold();

  const [grouped, setGrouped] = useState<"grouped" | "flat">("grouped");
  /**
   * What the list is showing: a period's `startDate`, or `month:YYYY-MM` for a
   * calendar month. Null follows the current period, which is the default and
   * what nearly every visit wants.
   *
   * One string rather than two pieces of state because it is one choice — two
   * would let the screen be in a state where both are set and neither wins.
   */
  const [selection, setSelection] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  /** Expense whose bank USD charge is being typed in, and the typed value. */
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyAmount, setVerifyAmount] = useState("");
  /** Expense whose detail dialog is open. */
  const [detailId, setDetailId] = useState<string | null>(null);
  // Seeded from a charge: the merchant and the figure the user is looking at.
  const [ruleSeed, setRuleSeed] = useState<
    { merchant: string; usdCents: number } | null
  >(null);

  // Only while the dialog is open. The hook takes null for "do not subscribe",
  // so the Servicios picker costs a listener exactly when somebody is looking
  // at it rather than on every visit to this screen.
  const servicesForRule = useServices(
    ruleSeed === null ? null : (household?.id ?? null),
  ).services;
  // Offered once per visit. Dismissing it must not bring it straight back —
  // the charges it asks about are still pending by design.
  const [promptDone, setPromptDone] = useState(false);
  const { rules: recurringRules, loading: rulesLoading } = useRecurringRules(
    household?.id ?? null,
  );
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Calendar months are a window, not a budget: they cross period boundaries
  // on purpose, so `selectedPeriod` is null for one and nothing draws a budget
  // bar off it. See lib/period-selection.ts, where this is tested.
  // Only the range and which kind it is: this screen lists expenses and never
  // draws a budget, so the period itself is not needed here even when there is
  // one. /datos and the dashboard are the ones that want it.
  const { range: selected, isMonth } = resolveSelection(
    selection,
    periods,
    currentPeriod,
  );

  const { expenses } = useExpensesRange(
    household?.id ?? null,
    selected?.startDate ?? null,
    selected?.endDate ?? null,
  );
  const { charges, loading: chargesLoading } = useBankCharges(
    household?.id ?? null,
  );

  const [addForm, setAddForm] = useState<FormState>({
    amount: "",
    categoryId: "groceries",
    note: "",
    date: "",
  });

  const categories = useSortedCategories(
    household ?? { categories: {} } as unknown as Household,
  );

  if (household === null || user === null) return null;

  const todayDate = today ?? "";
  const effectiveAddForm: FormState = {
    ...addForm,
    date: addForm.date !== "" ? addForm.date : todayDate,
    categoryId:
      household.categories[addForm.categoryId] !== undefined
        ? addForm.categoryId
        : (categories[0]?.id ?? "other"),
  };

  /** The last six calendar months, newest first — a look-back window, not a
   * budget. Six because a year of options in a native select is a scroll. */
  const monthOptions = recentMonths(todayDate, 6).map((m) => ({
    value: monthSelection(m.startDate),
    label: formatMonthLabel(m.startDate, locale),
  }));

  const members = household.memberIds
    .map((id) => ({ id, profile: household.memberProfiles[id] }))
    .filter((m) => m.profile !== undefined);

  /* Which rows the screen shows, and the days they print under. The filters,
     the sort and the grouping live in lib/expense-list.ts, where they can be
     tested — see expense-list.test.ts. */
  // The rate the household's own verified pairs reveal — the same one the
  // charges panel matches with, off the expenses already in memory.
  const learnedRate = learnRate(expenses);

  const { rows: sorted, days } = visibleExpenses(expenses, {
    category: categoryFilter,
    person: personFilter,
    verification: verificationFilter,
    search,
  });

  /* Add-row suggestions — derived ONLY from the already-loaded period
     expenses (no extra Firestore reads). Notes ranked by frequency, amounts
     by recency for the currently selected category. Thin history → empty. */
  const noteSuggestions = (() => {
    const counts = new Map<
      string,
      { text: string; count: number; lastMs: number }
    >();
    for (const e of expenses) {
      const note = e.note.trim();
      if (note === "") continue;
      const key = note.toLowerCase();
      const ms = e.createdAt?.toMillis() ?? 0;
      const prev = counts.get(key);
      if (prev !== undefined) {
        prev.count += 1;
        if (ms > prev.lastMs) {
          prev.lastMs = ms;
          prev.text = note; // keep the most recent casing/spelling
        }
      } else {
        counts.set(key, { text: note, count: 1, lastMs: ms });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || b.lastMs - a.lastMs)
      .slice(0, 5)
      .map((v) => v.text);
  })();

  // Resolved from the live list, so the dialog updates when the expense does
  // (verifying from inside it, a change landing from the other phone).
  const detailExpense = expenses.find((e) => e.id === detailId);


  const dayTitle = (date: string): { bold: string; muted: string } => {
    if (date === todayDate) {
      return { bold: t("today"), muted: formatDayHeading(date, locale) };
    }
    if (todayDate !== "" && date === addDays(todayDate, -1)) {
      return { bold: t("yesterday"), muted: formatDayHeading(date, locale) };
    }
    const heading = formatDayHeading(date, locale);
    const [weekday, ...rest] = heading.split(" ");
    return {
      bold: weekday.charAt(0).toUpperCase() + weekday.slice(1),
      muted: rest.join(" "),
    };
  };

  /* Mutations */
  // Firestore resolves a write only once the SERVER acknowledges it, so
  // awaiting one freezes the form for as long as the phone is offline — while
  // the expense is already in the local cache and on screen. Fire the write and
  // move on: the row appears either way, and a real rejection (rules) rolls it
  // back off the list, which is the honest signal. Same reasoning as iOS, which
  // has always written fire-and-forget.
  const submitAdd = () => {
    const fb = getFirebaseClient();
    const money = buildAmountFields(effectiveAddForm.amount, locale);
    if (fb === null || money === null || effectiveAddForm.date === "") return;
    write(
      addExpense(fb.db, household.id, user.uid, {
        ...money,
        categoryId: effectiveAddForm.categoryId,
        note: effectiveAddForm.note.trim(),
        date: effectiveAddForm.date,
      }),
    );
    setAddForm({ amount: "", categoryId: effectiveAddForm.categoryId, note: "", date: addForm.date });
    amountRef.current?.focus();
  };

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setEditForm({
      amount: (e.amountCents / 100).toLocaleString(
        locale === "es" ? "es-AR" : "en-AU",
        { minimumFractionDigits: 2, useGrouping: false },
      ),
      categoryId: e.categoryId,
      note: e.note,
      date: e.date,
    });
  };

  const submitEdit = () => {
    const fb = getFirebaseClient();
    if (fb === null || editingId === null || editForm === null) return;
    const money = buildAmountFields(editForm.amount, locale);
    if (money === null || editForm.date === "") return;
    const input: ExpenseInput = {
      ...money,
      categoryId: editForm.categoryId,
      note: editForm.note.trim(),
      date: editForm.date,
    };
    // Changing the amount invalidates a verification: the bank's USD was for
    // the old figure.
    const previous = expenses.find((e) => e.id === editingId);
    const amountChanged =
      previous !== undefined && previous.amountCents !== input.amountCents;
    write(
      updateExpense(
        fb.db,
        household.id,
        editingId,
        input,
        amountChanged && previous.verified,
      ),
    );
    setEditingId(null);
    setEditForm(null);
  };

  /* Verification: the USD figure the bank charged, typed in after the fact. */
  const startVerify = (e: Expense) => {
    setVerifyingId(e.id);
    setVerifyAmount(
      e.usdCents === null
        ? ""
        : (e.usdCents / 100).toLocaleString(
            locale === "es" ? "es-AR" : "en-AU",
            { minimumFractionDigits: 2, useGrouping: false },
          ),
    );
  };

  const submitVerify = (usdCents: number | null) => {
    const fb = getFirebaseClient();
    if (fb === null || verifyingId === null) return;
    write(setExpenseVerification(fb.db, household.id, verifyingId, usdCents));
    setVerifyingId(null);
    setVerifyAmount("");
  };

  const removeExpense = async (e: Expense) => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    const ok = window.confirm(
      t("deleteConfirm", {
        amount: formatCents(e.amountCents, household.currency, locale),
      }),
    );
    if (!ok) return;
    await deleteExpense(fb.db, household.id, e.id);
  };

  /* CSV export of the CURRENTLY FILTERED list (client-side download).
     Shares the builder with the Datos page so the format stays in sync. */
  const exportCsv = () => {
    // Same promise the Datos page makes with its checkbox: unverified rows
    // leave a blank USD column, so say so before the file is written.
    const unverified = sorted.filter((e) => !e.verified).length;
    if (
      unverified > 0 &&
      !window.confirm(t("exportUnverifiedConfirm", { count: unverified }))
    ) {
      return;
    }
    const memberNames = Object.fromEntries(
      Object.entries(household.memberProfiles).map(([uid, p]) => [
        uid,
        p.displayName,
      ]),
    );
    const csv = buildExpensesCsv(sorted, {
      categories,
      members: memberNames,
      deletedLabel: tCat("deleted"),
    });
    downloadCsv(`gastos-${selected?.startDate ?? "todos"}.csv`, csv);
  };

  /* Row rendering */
  const renderRow = (e: Expense, flat: boolean) => {
    const def = household.categories[e.categoryId];
    // Deleted category: neutral icon (below) + a readable label, never the
    // raw doc id.
    const catLabel =
      categories.find((c) => c.id === e.categoryId)?.label ?? tCat("deleted");

    if (verifyingId === e.id) {
      const typed = parseAmountToCents(verifyAmount, locale);
      return (
        <div
          key={e.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 py-[9px]"
        >
          {/* On a phone the note takes its own line so the controls below it
              keep their full width instead of truncating to two letters. */}
          <span className="w-full truncate text-sm font-semibold text-ink sm:w-auto sm:min-w-0 sm:flex-1">
            {e.note !== "" ? e.note : catLabel}
          </span>
          <span className="tnum text-sm font-bold text-ink">
            {formatCents(e.amountCents, household.currency, locale)}
          </span>
          <label className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink-3">US$</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={verifyAmount}
              onChange={(event) => setVerifyAmount(event.target.value)}
              placeholder={t("amountPlaceholder")}
              aria-label={t("bankUsd")}
              className="tnum w-24 rounded-[10px] border border-pill bg-bg px-3 py-2 text-[13.5px] font-semibold text-ink outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => submitVerify(typed)}
            disabled={typed === null}
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
          >
            {t("markVerified")}
          </button>
          {e.verified && (
            <button
              type="button"
              onClick={() => submitVerify(null)}
              className="text-[13px] font-semibold text-ink-2"
            >
              {t("clearVerification")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setVerifyingId(null);
              setVerifyAmount("");
            }}
            className="text-[13px] font-semibold text-ink-2"
          >
            {t("cancel")}
          </button>
        </div>
      );
    }

    if (editingId === e.id && editForm !== null) {
      return (
        <div key={e.id} className="flex flex-wrap items-center gap-3 py-[9px]">
          <ExpenseFormFields
            form={editForm}
            setForm={setEditForm}
            categories={categories}
            noteSuggestions={noteSuggestions}
          />
          <button
            type="button"
            onClick={submitEdit}
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
          >
            {t("save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setEditForm(null);
            }}
            className="text-[13px] font-semibold text-ink-2"
          >
            {t("cancel")}
          </button>
        </div>
      );
    }

    return (
      <div
        key={e.id}
        // Clicking anywhere on the row opens its detail. The row itself is NOT
        // a button: it holds three of them, and a button inside a button is
        // invalid ARIA. The note below is the real, focusable control, so the
        // keyboard and screen readers get a proper target.
        onClick={() => setDetailId(e.id)}
        className={`grid cursor-pointer items-center gap-2 py-[9px] lg:gap-3 ${
          // Below lg (iPad portrait) the category/date columns are hidden and
          // the note takes the remaining space — the full grid needs ~900px.
          flat
            ? "grid-cols-[38px_minmax(0,1fr)_auto_68px] lg:grid-cols-[44px_1.6fr_1fr_90px_120px_76px]"
            : "grid-cols-[38px_minmax(0,1fr)_auto_68px] lg:grid-cols-[44px_1.6fr_1fr_120px_76px]"
        }`}
      >
        <div
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{
            background: def ? categoryCircleBg(e.categoryId, def) : "var(--fill)",
          }}
        >
          <Icon
            name={def?.icon ?? "more_horiz"}
            size={17}
            style={{
              color: def
                ? categoryColor(e.categoryId, def)
                : "var(--ink-secondary)",
            }}
          />
        </div>
        <span className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setDetailId(e.id);
            }}
            className="truncate text-left text-sm font-semibold text-ink"
          >
            {e.note !== "" ? e.note : catLabel}
          </button>
          {/* An expense nobody typed says so, and offers the way back.
              The undo lives on the row rather than in a menu because its
              window is short: it lasts exactly as long as the charge does,
              48 hours, and then the sweep takes the charge and this becomes
              an ordinary expense. */}
          {e.autoRuleId !== null && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                const fb = getFirebaseClient();
                const chargeId = chargeIdFromAutoExpense(e.id);
                if (fb === null || chargeId === null) return;
                write(
                  undoRecurringExpense(fb.db, household.id, e.id, chargeId),
                );
              }}
              title={t("undoAuto")}
              aria-label={`${t("undoAuto")} — ${
                e.note !== "" ? e.note : catLabel
              }`}
              className="flex flex-none items-center gap-1 text-[11px] font-semibold text-ink-3"
            >
              <Icon name="autorenew" size={13} />
            </button>
          )}
          {/* An amount worked out from the learned rate, not one anybody
              stated. Said on the row rather than only in the detail, because
              an estimate nobody can see is just a number — and the row is
              where you would notice it was off. Tapping the row edits it. */}
          {e.autoEstimated && (
            <span className="flex-none text-[11px] font-semibold text-warn-text">
              {t("estimated")}
            </span>
          )}
          {e.pendingWrite && (
            <span
              className="flex flex-none items-center gap-1 text-[11px] font-semibold text-ink-3"
              title={t("pending")}
            >
              <Icon name="cloud_off" size={13} className="text-ink-3" />
            </span>
          )}
        </span>
        <span className="hidden truncate text-[13px] text-ink-2 lg:block">
          {catLabel}
        </span>
        {flat && (
          <span className="tnum hidden text-[13px] text-ink-2 lg:block">
            {formatShortDate(e.date, locale)}
          </span>
        )}
        {/* The amount, plus the bank's USD charge underneath. That second line
            IS the verify control: tapping it types the figure in (or corrects
            one already recorded). */}
        <div className="flex flex-col items-end gap-px">
          <span className="tnum text-sm font-bold text-ink">
            {formatCents(e.amountCents, household.currency, locale)}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              startVerify(e);
            }}
            title={e.verified ? t("editBankUsd") : t("addBankUsd")}
            /* Named by its expense, because there is one of these per row.
               Without the note and the amount every button in the grid reads
               "Sin verificar — Cargar el USD del banco", identical however
               many rows there are: on screen the row says which one, and to
               anyone navigating by voice, nothing does. The iOS history row
               was fixed for this months-old reason (children: .combine) and
               the web twin never was. The e2e spec had to reach this button by
               filtering on its row's text, which is the same defect showing up
               as a test that cannot name what it is clicking. */
            aria-label={`${e.verified ? t("verified") : t("unverified")} — ${
              e.verified ? t("editBankUsd") : t("addBankUsd")
            } — ${e.note !== "" ? e.note : catLabel}, ${formatCents(
              e.amountCents,
              household.currency,
              locale,
            )}`}
            className="flex items-center gap-1"
            style={{ color: e.verified ? "var(--good-text)" : "var(--warn-text)" }}
          >
            <Icon
              name={e.verified ? "check_circle" : "error"}
              size={13}
              style={{ color: "inherit" }}
            />
            <span className="tnum text-[11.5px] font-semibold">
              {e.verified && e.usdCents !== null
                ? formatUsd(e.usdCents, locale)
                : t("unverified")}
            </span>
          </button>
        </div>
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            aria-label={t("edit")}
            onClick={(event) => {
              event.stopPropagation();
              startEdit(e);
            }}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
            style={{ background: "rgba(42,111,219,.1)" }}
          >
            <Icon name="edit" size={15} style={{ color: "var(--member-blue)" }} />
          </button>
          <button
            type="button"
            aria-label={t("delete")}
            onClick={(event) => {
              event.stopPropagation();
              void removeExpense(e);
            }}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
            style={{ background: "var(--over-bg)" }}
          >
            <Icon name="delete" size={15} style={{ color: "var(--over)" }} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="hidden items-center gap-1.5 rounded-full border border-pill bg-surface px-3 py-[5px] disabled:opacity-40 lg:flex"
            title={t("exportCsv")}
          >
            <Icon name="download" size={15} className="text-ink-2" />
            <span className="text-xs font-semibold text-ink-2">
              {t("exportCsv")}
            </span>
          </button>
          <Segmented
            options={[
              { value: "grouped", label: t("groupedByDay") },
              { value: "flat", label: t("flatList") },
            ]}
            value={grouped}
            onChange={setGrouped}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        {selected !== null && (
          <FilterPill>
            <Icon name="calendar_today" size={16} className="text-ink-2" />
            <span className="text-[13px] font-semibold text-ink">
              {isMonth
                ? formatMonthLabel(selected.startDate, locale)
                : formatPeriodRange(
                    selected.startDate,
                    selected.endDate,
                    locale,
                    "short",
                  )}
            </span>
            <Icon name="expand_more" size={16} className="text-ink-3" />
            <select
              aria-label="period"
              value={selection ?? selected.startDate}
              onChange={(e) => setSelection(e.target.value)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            >
              {/* Two kinds of window, told apart by their group rather than by
                  the reader working out that "1 – 31 ago" is not a fortnight. */}
              <optgroup label={t("groupMonths")}>
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("groupPeriods")}>
                {[...periods].reverse().map((p) => (
                  <option key={p.startDate} value={p.startDate}>
                    {formatPeriodRange(p.startDate, p.endDate, locale, "short")}
                  </option>
                ))}
              </optgroup>
            </select>
          </FilterPill>
        )}
        <PillSelect
          ariaLabel="category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: "all", label: t("categoryAll") },
            ...categories.map((c) => ({
              value: c.id,
              label: t("categoryFilter", { name: c.label }),
            })),
          ]}
        />
        <PillSelect
          ariaLabel="verification"
          value={verificationFilter}
          onChange={(value) => setVerificationFilter(value as VerificationFilter)}
          options={[
            { value: "all", label: t("verificationAll") },
            { value: "unverified", label: t("unverified") },
            { value: "verified", label: t("verified") },
          ]}
        />
        <PillSelect
          ariaLabel="person"
          value={personFilter}
          onChange={setPersonFilter}
          options={[
            { value: "all", label: t("personAll") },
            ...members.map((m) => ({
              value: m.id,
              label: t("personFilter", {
                name: m.profile.displayName.split(" ")[0],
              }),
            })),
          ]}
        />
        <div className="flex-1" />
        <div className="flex min-w-[220px] items-center gap-1.5 rounded-full border border-pill bg-surface px-3.5 py-2">
          <Icon name="search" size={16} className="text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
      </div>

      {/* Bank charges the email ingestion has imported but nobody has matched
          to an expense yet. Hidden entirely when there are none. */}
      <BankChargesPanel
        household={household}
        charges={charges}
        expenses={expenses}
        expenseLabel={(e) =>
          e.note !== ""
            ? e.note
            : (categories.find((c) => c.id === e.categoryId)?.label ??
              tCat("deleted"))
        }
        onMakeRecurring={setRuleSeed}
        locale={locale}
      />

      {/* A rule seeded from a charge: the merchant and the figure are already
          on screen, so the dialog opens filled in. */}
      {ruleSeed !== null && (
        <RecurringRuleDialog
          rule={null}
          household={household}
          locale={locale}
          pendingMerchants={charges.filter(isPending).map((c) => c.merchant)}
          services={servicesForRule}
          seed={ruleSeed}
          onSave={(input) => {
            const fb = getFirebaseClient();
            if (fb === null || user === null) return;
            // Save it AND file what it already recognises. The icon that
            // opened this sits on a pending charge, so that charge is the
            // whole reason the rule exists — leaving it in the list until the
            // next launch made the rule look like it had not worked.
            write(
              (async () => {
                const ruleId = await addRecurringRule(
                  fb.db,
                  household.id,
                  user.uid,
                  input,
                );
                for (const claim of claimsOfOneRule(
                  charges.filter(isPending),
                  { id: ruleId, ...input },
                  learnedRate,
                )) {
                  if (claim.amountAudCents === null) continue;
                  await fileRecurringExpense(
                    fb.db,
                    household.id,
                    user.uid,
                    claim.charge,
                    {
                      id: ruleId,
                      categoryId: input.categoryId,
                      note: input.note,
                    },
                    claim.amountAudCents,
                    claim.estimated,
                  );
                }
              })(),
            );
            setRuleSeed(null);
          }}
          onDelete={null}
          onClose={() => setRuleSeed(null)}
        />
      )}

      {/* What the rules did while you were away, and what they still need. */}
      {/* Only once BOTH listeners have answered.
          While they are loading each is an empty list, and an empty list is
          indistinguishable from "no rule matched anything" — the prompt would
          conclude there was nothing to say and close itself a moment before
          the data arrived. Same trap the charges listener already documents:
          a read in flight is not a read that came back empty. */}
      {!promptDone && !chargesLoading && !rulesLoading && (
        <RecurringPrompt
          charges={charges.filter(isPending)}
          rules={recurringRules}
          learnedRate={learnedRate}
          locale={locale}
          onFile={async (charge, rule, amountAudCents, estimated) => {
            const fb = getFirebaseClient();
            if (fb === null || user === null) return;
            await fileRecurringExpense(
              fb.db,
              household.id,
              user.uid,
              charge,
              rule,
              amountAudCents,
              estimated,
            );
          }}
          onDismissed={() => setPromptDone(true)}
        />
      )}

      {/* Quick-entry shortcut — the phone's replacement for the add row below */}
      <Link
        href="/nuevo"
        className="flex items-center justify-center gap-2 rounded-full bg-accent py-3 text-sm font-bold text-white shadow-[0_6px_16px_rgba(255,92,57,.3)] lg:hidden"
      >
        <Icon name="add" size={18} className="text-white" />
        {tDash("newExpense")}
      </Link>

      {/* Inline add row (desktop: five controls on one line) */}
      <div
        className="hidden flex-col gap-2 rounded-2xl bg-surface px-4 py-2.5 lg:flex"
        style={{ border: "2px dashed rgba(255,92,57,.4)" }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Icon name="add_circle" size={20} className="text-accent" />
          <ExpenseFormFields
            form={effectiveAddForm}
            setForm={setAddForm}
            categories={categories}
            amountRef={amountRef}
            noteSuggestions={noteSuggestions}
          />
          <button
            type="button"
            onClick={submitAdd}
            disabled={parseAmountToCents(effectiveAddForm.amount, locale) === null}
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
          >
            {t("save")}
          </button>
        </div>
      </div>

      {/* Detail of a tapped expense */}
      {detailExpense !== undefined && (
        <ExpenseDetailDialog
          expense={detailExpense}
          household={household}
          periods={periods}
          categoryLabel={
            categories.find((c) => c.id === detailExpense.categoryId)?.label ??
            tCat("deleted")
          }
          locale={locale}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            startEdit(detailExpense);
          }}
          onVerify={() => {
            setDetailId(null);
            startVerify(detailExpense);
          }}
          onDelete={() => {
            setDetailId(null);
            void removeExpense(detailExpense);
          }}
        />
      )}

      {/* Rows */}
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <Icon
            name={expenses.length === 0 ? "receipt_long" : "search_off"}
            size={24}
            className="text-ink-3"
          />
          <div className="flex flex-1 flex-col gap-px">
            <span className="text-[13.5px] font-bold text-ink">
              {expenses.length === 0
                ? tEmpty("noExpensesTitle")
                : t("noResults")}
            </span>
            <span className="text-xs text-ink-3">
              {expenses.length === 0
                ? tEmpty("noExpensesHint")
                : t("noResultsHint")}
            </span>
          </div>
          {expenses.length === 0 && (
            <button
              type="button"
              onClick={() => amountRef.current?.focus()}
              className="hidden rounded-full bg-accent px-[13px] py-1.5 text-xs font-bold text-white lg:block"
            >
              {tDash("newExpense")}
            </button>
          )}
        </div>
      ) : grouped === "grouped" ? (
        <div className="flex flex-col gap-3">
          {days.map((d) => {
            const title = dayTitle(d.date);
            return (
              <div key={d.date} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between px-1.5">
                  <span className="text-[12.5px] font-bold text-ink">
                    {title.bold}{" "}
                    <span className="font-medium text-ink-3">
                      · {title.muted}
                    </span>
                  </span>
                  <span className="tnum text-xs font-semibold text-ink-2">
                    {formatCents(d.totalCents, household.currency, locale)}
                  </span>
                </div>
                <div className="divide-y divide-soft rounded-2xl border border-line bg-surface px-[18px] py-0.5">
                  {d.rows.map((e) => renderRow(e, false))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-soft rounded-2xl border border-line bg-surface px-[18px] py-0.5">
          {sorted.map((e) => renderRow(e, true))}
        </div>
      )}
    </div>
  );
}
