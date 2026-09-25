"use client";

// Gastos (design 4b): filters, inline dashed add row, day-grouped or flat
// list, inline edit and delete per row.

import {
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { useAppError } from "@/components/app-error";
import { Icon } from "@/components/ui/icon";
import { canAddExpense } from "@/lib/period-gate";
import { useExpenseFilters } from "@/components/use-expense-filters";
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
import { EditExpenseRow, VerifyExpenseRow } from "./rows";
import { learnRate } from "@/lib/bank-match";
import {
  claimsOfOneRule,
  planRecurringRun,
  type ClaimedCharge,
} from "@/lib/recurring";
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
import type { BankChargeDoc, Expense, Household } from "@/lib/firebase/converters";
import { categoryCircleBg, categoryColor } from "@/lib/categories";
import {
  formatCents,
  formatUsd,
  parseAmountToCents,
} from "@/lib/money";
import {
  capitaliseFirst,
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
  const { household, periods, currentPeriod, today, deferredStart, openStartPeriod } =
    useHousehold();

  /**
   * What the list is showing: a period's `startDate`, or `month:YYYY-MM` for a
   * calendar month. Null follows the current period, which is the default and
   * what nearly every visit wants.
   *
   * One string rather than two pieces of state because it is one choice — two
   * would let the screen be in a state where both are set and neither wins.
   */
  const [selection, setSelection] = useState<string | null>(null);
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
  // One run of the recurring rules at a time, planned by `planRecurringRun` —
  // the same plan iOS makes, held to the same shared vectors — and carried out
  // here. Two memories, kept apart on purpose:
  //
  // - `seen`: charges already put through a run on this visit. A run happens
  //   only when something not in here arrives.
  // - `filed`: charges this visit filed, by a rule or by an answer. Undo puts
  //   a charge back in the pending list on purpose, and without this the next
  //   arrival filed it straight back — measured by the e2e, which undoes, lets
  //   another charge in, and found the first one filed again.
  //
  // Refs, not state: both are read synchronously inside the effect that
  // plans, and both must be marked BEFORE the writes — the listener fires again
  // the moment the first expense lands, and a mark set after would let that
  // render start the same charges over.
  const seenChargeIds = useRef(new Set<string>());
  const filedChargeIds = useRef(new Set<string>());
  // What the open prompt reports and asks, captured when planned. Captured
  // because read live, answering a question took it out from under the
  // prompt's index and the next one slid into the slot just passed: with two
  // to answer, the second was never asked.
  const [promptFiled, setPromptFiled] = useState<ClaimedCharge<BankChargeDoc>[]>([]);
  const [promptAsk, setPromptAsk] = useState<ClaimedCharge<BankChargeDoc>[]>([]);
  // Whether it is up is its own state, not derived from what is pending:
  // filing is the prompt's whole job and a filed charge stops being pending,
  // so a derived condition went false mid-flight and the prompt vanished a
  // beat before it could report.
  const [promptOpen, setPromptOpen] = useState(false);
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

  // The filter bar's five pieces of state and the rows they produce, as one
  // thing — see components/use-expense-filters.ts.
  //
  // Called HERE, above the early return below, because that is where the five
  // useStates it replaced were. Moving it down to where the rows get used
  // read better and was wrong: a hook after a conditional return does not run
  // on every render. Neither the unit tests nor the e2e caught it — the early
  // return only fires while the household is still loading — and lint did.
  const filters = useExpenseFilters(expenses);
  const { charges, loading: chargesLoading } = useBankCharges(
    household?.id ?? null,
  );
  // The pending ones, worked out once. It was `charges.filter(isPending)`
  // written out at each of the three places that wanted it, which is the set
  // being decided three times — and the fourth caller is the one that decides
  // whether the prompt is shown at all.
  const pendingCharges = charges.filter(isPending);

  // Pure over what is already loaded, so it can sit above the early return and
  // feed the effect below.
  const learnedRate = learnRate(expenses);

  // The run. Above the early return, like every other hook here — see the
  // note on useExpenseFilters for what putting one below it costs.
  const householdId = household?.id ?? null;
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (chargesLoading || rulesLoading || householdId === null || uid === null) return;
    const plan = planRecurringRun(
      charges.filter(isPending),
      recurringRules,
      learnedRate,
      seenChargeIds.current,
      filedChargeIds.current,
    );
    if (plan.fresh.length === 0) return;
    for (const id of plan.fresh) seenChargeIds.current.add(id);
    for (const claim of plan.file) filedChargeIds.current.add(claim.charge.id);
    if (plan.file.length === 0 && plan.ask.length === 0) return;
    // Reported as planned rather than as each write lands: Firestore applies
    // the local write at once and resolves the promise only when the server
    // answers, and a report that waited for that left the prompt open with
    // nothing in it. A write the server refuses says so through the app's
    // own error alert.
    const merge = (
      list: ClaimedCharge<BankChargeDoc>[],
      more: ClaimedCharge<BankChargeDoc>[],
    ) => [...list, ...more.filter((m) => !list.some((l) => l.charge.id === m.charge.id))];
    // The cascade IS the job: something arrived, and the render after this
    // one is the one that puts the prompt up.
    setPromptFiled((f) => merge(f, plan.file));
    setPromptAsk((q) => merge(q, plan.ask));
    setPromptOpen(true);
    const fb = getFirebaseClient();
    if (fb === null) return;
    void (async () => {
      // Sequential on purpose: each is its own batch, and a burst of parallel
      // writes is how a free-tier quota disappears.
      for (const claim of plan.file) {
        if (claim.amountAudCents === null) continue;
        const filing = fileRecurringExpense(
          fb.db, householdId, uid, claim.charge, claim.rule,
          claim.amountAudCents, claim.estimated,
        );
        // Reported through the app's alert, and awaited here only to keep
        // the writes one at a time — a refused one must not stop the rest.
        write(filing);
        await filing.catch(() => {});
      }
    })();
  }, [charges, recurringRules, learnedRate, chargesLoading, rulesLoading, householdId, uid, write]);

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

  const { rows: sorted, days } = filters;

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
      bold: capitaliseFirst(weekday),
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
    // Refused while the period under way has not been started, which is the
    // state "Todavía no arrancar" leaves behind. Without this the button
    // would be the old swipe-away: an expense counted against a budget nobody
    // chose, with the screen that would have asked already gone.
    if (!canAddExpense({ currentPeriod, deferredStart })) {
      openStartPeriod();
      return;
    }
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
      return (
        <VerifyExpenseRow
          key={e.id}
          expense={e}
          household={household}
          locale={locale}
          catLabel={catLabel}
          verifyAmount={verifyAmount}
          setVerifyAmount={setVerifyAmount}
          submitVerify={submitVerify}
          cancelVerify={() => {
            setVerifyingId(null);
            setVerifyAmount("");
          }}
          t={t}
        />
      );
    }

    if (editingId === e.id && editForm !== null) {
      return (
        <EditExpenseRow
          key={e.id}
          expense={e}
          editForm={editForm}
          setEditForm={setEditForm}
          categories={categories}
          noteSuggestions={noteSuggestions}
          submitEdit={submitEdit}
          cancelEdit={() => {
            setEditingId(null);
            setEditForm(null);
          }}
          t={t}
        />
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
            style={{ color: e.verified ? "var(--good-text)" : "var(--info-text)" }}
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
            value={filters.grouping}
            onChange={filters.setGrouping}
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
          value={filters.category}
          onChange={filters.setCategory}
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
          value={filters.verification}
          onChange={(value) => filters.setVerification(value as VerificationFilter)}
          options={[
            { value: "all", label: t("verificationAll") },
            { value: "unverified", label: t("unverified") },
            { value: "verified", label: t("verified") },
          ]}
        />
        <PillSelect
          ariaLabel="person"
          value={filters.person}
          onChange={filters.setPerson}
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
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
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
          pendingMerchants={pendingCharges.map((c) => c.merchant)}
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
                  pendingCharges,
                  { id: ruleId, ...input },
                  learnedRate,
                )) {
                  if (claim.amountAudCents === null) continue;
                  // Filed by this visit, like everything the prompt files, so
                  // an undo is not filed back by the next arrival.
                  filedChargeIds.current.add(claim.charge.id);
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
      {promptOpen && (
        <RecurringPrompt
          filed={promptFiled}
          asking={promptAsk}
          currency={household.currency}
          locale={locale}
          onAnswer={async (claim, amountAudCents) => {
            // Filed by this visit, so an undo does not bring it straight back
            // once a rate is known and the plan could estimate it.
            filedChargeIds.current.add(claim.charge.id);
            const fb = getFirebaseClient();
            if (fb === null) return;
            const filing = fileRecurringExpense(
              fb.db, household.id, user.uid, claim.charge, claim.rule,
              amountAudCents, false,
            );
            write(filing);
            await filing.catch(() => {});
          }}
          onDismissed={() => {
            // What it reported and asked is over; what was FILED is still
            // remembered, which is what keeps an undo from coming back.
            setPromptOpen(false);
            setPromptFiled([]);
            setPromptAsk([]);
          }}
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
        className="hidden flex-col gap-2 rounded-[18px] bg-surface px-4 py-2.5 lg:flex"
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
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white primary-disabled"
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
        <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-3.5">
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
      ) : filters.grouping === "grouped" ? (
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
                <div className="divide-y divide-soft rounded-[18px] border border-line bg-surface px-[18px] py-0.5">
                  {d.rows.map((e) => renderRow(e, false))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-soft rounded-[18px] border border-line bg-surface px-[18px] py-0.5">
          {sorted.map((e) => renderRow(e, true))}
        </div>
      )}
    </div>
  );
}
