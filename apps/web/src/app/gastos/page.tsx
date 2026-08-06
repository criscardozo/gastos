"use client";

// Gastos (design 4b): filters, inline dashed add row, day-grouped or flat
// list, inline edit and delete per row.

import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { BankChargesPanel } from "@/components/bank-charges-panel";
import { ExpenseDetailDialog } from "@/components/expense-detail-dialog";
import { useBankCharges, useExpensesRange } from "@/lib/firebase/hooks";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  addExpense,
  deleteExpense,
  setExpenseVerification,
  updateExpense,
  type ExpenseInput,
} from "@/lib/firebase/mutations";
import type { Expense, Household, PeriodBudget } from "@/lib/firebase/converters";
import { categoryCircleBg, categoryColor, type CategoryDef } from "@/lib/categories";
import {
  formatCents,
  formatCentsCompact,
  formatUsd,
  parseAmountToCents,
} from "@/lib/money";
import { formatDayHeading, formatPeriodRange, formatShortDate } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { buildExpensesCsv, downloadCsv } from "@/lib/export/csv";

/* ── Small helpers ─────────────────────────────────────────────────────── */

function FilterPill({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex items-center gap-1.5 rounded-full border border-pill bg-surface px-3.5 py-2">
      {children}
    </div>
  );
}

function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <FilterPill>
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <Icon name="expand_more" size={16} className="text-ink-3" />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterPill>
  );
}

interface SortedCategory {
  id: string;
  def: CategoryDef;
  label: string;
}

function useSortedCategories(household: Household): SortedCategory[] {
  const t = useTranslations("categories");
  return useMemo(
    () =>
      Object.entries(household.categories)
        .map(([id, def]) => ({
          id,
          def,
          label: def.key !== undefined ? t(def.key) : (def.name ?? id),
        }))
        .sort((a, b) => a.def.sortOrder - b.def.sortOrder),
    [household, t],
  );
}

/* ── Inline expense form (add + edit share it) ─────────────────────────── */

interface FormState {
  amount: string;
  categoryId: string;
  note: string;
  date: string;
}

function ExpenseFormFields({
  form,
  setForm,
  categories,
  amountRef,
  noteSuggestions,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  categories: SortedCategory[];
  amountRef?: React.RefObject<HTMLInputElement | null>;
  /** Most frequent recent notes offered as native autocomplete options. */
  noteSuggestions?: string[];
}) {
  const t = useTranslations("expenses");
  // Unique per instance so the add and edit rows never share a datalist id.
  const noteListId = useId();
  const hasNoteSuggestions =
    noteSuggestions !== undefined && noteSuggestions.length > 0;
  return (
    <>
      <input
        ref={amountRef}
        type="text"
        inputMode="decimal"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
        placeholder={t("amountPlaceholder")}
        aria-label={t("amountPlaceholder")}
        className="tnum w-24 rounded-[10px] border border-pill bg-bg px-3 py-2 text-[13.5px] font-semibold text-ink outline-none"
      />
      <select
        value={form.categoryId}
        onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        aria-label={t("categoryAll")}
        className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13.5px] font-semibold text-ink outline-none"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder={t("notePlaceholder")}
        aria-label={t("notePlaceholder")}
        maxLength={200}
        list={hasNoteSuggestions ? noteListId : undefined}
        className="min-w-0 flex-1 rounded-[10px] border border-pill bg-bg px-3 py-2 text-[13.5px] text-ink outline-none"
      />
      {hasNoteSuggestions && (
        <datalist id={noteListId}>
          {noteSuggestions.map((note) => (
            <option key={note} value={note} />
          ))}
        </datalist>
      )}
      <input
        type="date"
        value={form.date}
        onChange={(e) => {
          if (e.target.value !== "") setForm({ ...form, date: e.target.value });
        }}
        aria-label="date"
        className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13.5px] font-semibold text-ink outline-none"
      />
    </>
  );
}

/** Which verification state the list is narrowed to. */
type VerificationFilter = "all" | "unverified" | "verified";

/** Typed amount → the expense's AUD cents, or null when unparsable. */
function buildAmountFields(
  amount: string,
): Pick<ExpenseInput, "amountCents"> | null {
  const amountCents = parseAmountToCents(amount);
  return amountCents === null ? null : { amountCents };
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ExpensesPage() {
  const t = useTranslations("expenses");
  const tEmpty = useTranslations("empty");
  const tDash = useTranslations("dashboard");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { household, periods, currentPeriod, today } = useHousehold();

  const [grouped, setGrouped] = useState<"grouped" | "flat">("grouped");
  const [periodStart, setPeriodStart] = useState<string | null>(null);
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
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  const fallbackPeriod: PeriodBudget | null =
    currentPeriod ?? periods[periods.length - 1] ?? null;
  const selected =
    (periodStart !== null
      ? periods.find((p) => p.startDate === periodStart)
      : undefined) ?? fallbackPeriod;

  const { expenses } = useExpensesRange(
    household?.id ?? null,
    selected?.startDate ?? null,
    selected?.endDate ?? null,
  );
  const { charges } = useBankCharges(household?.id ?? null);

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

  const members = household.memberIds
    .map((id) => ({ id, profile: household.memberProfiles[id] }))
    .filter((m) => m.profile !== undefined);

  /* Filtering (search is client-side over notes) */
  const query = search.trim().toLowerCase();
  const filtered = expenses
    .filter((e) => categoryFilter === "all" || e.categoryId === categoryFilter)
    .filter((e) => personFilter === "all" || e.createdBy === personFilter)
    .filter(
      (e) =>
        verificationFilter === "all" ||
        (verificationFilter === "verified" ? e.verified : !e.verified),
    )
    .filter((e) => query === "" || e.note.toLowerCase().includes(query));

  const byCreated = (a: Expense, b: Expense): number => {
    const at = a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
    return bt - at;
  };
  const sorted = [...filtered].sort(
    (a, b) => b.date.localeCompare(a.date) || byCreated(a, b),
  );

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

  const amountSuggestions = (() => {
    const catId = effectiveAddForm.categoryId;
    const seen = new Set<number>();
    const out: number[] = [];
    for (const e of [...expenses].sort(byCreated)) {
      if (e.categoryId !== catId || seen.has(e.amountCents)) continue;
      seen.add(e.amountCents);
      out.push(e.amountCents);
      if (out.length >= 3) break;
    }
    return out;
  })();

  /* Fill the amount field from a recent-amount chip (uses the same decimal
     format as the inline input so parseAmountToCents accepts it). */
  const fillAmount = (cents: number) => {
    const str = (cents / 100).toLocaleString(
      locale === "es" ? "es-AR" : "en-AU",
      { minimumFractionDigits: 2, useGrouping: false },
    );
    setAddForm({ ...addForm, amount: str });
    amountRef.current?.focus();
  };

  // Resolved from the live list, so the dialog updates when the expense does
  // (verifying from inside it, a change landing from the other phone).
  const detailExpense = expenses.find((e) => e.id === detailId);

  const days: { date: string; rows: Expense[]; total: number }[] = [];
  for (const e of sorted) {
    const last = days[days.length - 1];
    if (last !== undefined && last.date === e.date) {
      last.rows.push(e);
      last.total += e.amountCents;
    } else {
      days.push({ date: e.date, rows: [e], total: e.amountCents });
    }
  }

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
  const submitAdd = async () => {
    const fb = getFirebaseClient();
    const money = buildAmountFields(effectiveAddForm.amount);
    if (fb === null || money === null || effectiveAddForm.date === "") return;
    setSaving(true);
    try {
      await addExpense(fb.db, household.id, user.uid, {
        ...money,
        categoryId: effectiveAddForm.categoryId,
        note: effectiveAddForm.note.trim(),
        date: effectiveAddForm.date,
      });
      setAddForm({ amount: "", categoryId: effectiveAddForm.categoryId, note: "", date: addForm.date });
      amountRef.current?.focus();
    } finally {
      setSaving(false);
    }
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

  const submitEdit = async () => {
    const fb = getFirebaseClient();
    if (fb === null || editingId === null || editForm === null) return;
    const money = buildAmountFields(editForm.amount);
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
    setSaving(true);
    try {
      await updateExpense(
        fb.db,
        household.id,
        editingId,
        input,
        amountChanged && previous.verified,
      );
      setEditingId(null);
      setEditForm(null);
    } finally {
      setSaving(false);
    }
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

  const submitVerify = async (usdCents: number | null) => {
    const fb = getFirebaseClient();
    if (fb === null || verifyingId === null) return;
    setSaving(true);
    try {
      await setExpenseVerification(fb.db, household.id, verifyingId, usdCents);
      setVerifyingId(null);
      setVerifyAmount("");
    } finally {
      setSaving(false);
    }
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
      const typed = parseAmountToCents(verifyAmount);
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
            onClick={() => void submitVerify(typed)}
            disabled={saving || typed === null}
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
          >
            {t("markVerified")}
          </button>
          {e.verified && (
            <button
              type="button"
              onClick={() => void submitVerify(null)}
              disabled={saving}
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
            onClick={() => void submitEdit()}
            disabled={saving}
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
            aria-label={`${e.verified ? t("verified") : t("unverified")} — ${
              e.verified ? t("editBankUsd") : t("addBankUsd")
            }`}
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
              {formatPeriodRange(selected.startDate, selected.endDate, locale, "short")}
            </span>
            <Icon name="expand_more" size={16} className="text-ink-3" />
            <select
              aria-label="period"
              value={selected.startDate}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            >
              {[...periods].reverse().map((p) => (
                <option key={p.startDate} value={p.startDate}>
                  {formatPeriodRange(p.startDate, p.endDate, locale, "short")}
                </option>
              ))}
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
        locale={locale}
      />

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
            onClick={() => void submitAdd()}
            disabled={saving || parseAmountToCents(effectiveAddForm.amount) === null}
            className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
          >
            {t("save")}
          </button>
        </div>
        {amountSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-8">
            <span className="text-[11px] font-semibold text-ink-3">
              {t("recentAmounts")}
            </span>
            {amountSuggestions.map((cents) => {
              const label = formatCentsCompact(cents, household.currency, locale);
              return (
                <button
                  key={cents}
                  type="button"
                  onClick={() => fillAmount(cents)}
                  aria-label={t("useAmount", { amount: label })}
                  className="tnum rounded-full border border-pill bg-fill px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-track"
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
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
                    {formatCents(d.total, household.currency, locale)}
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
