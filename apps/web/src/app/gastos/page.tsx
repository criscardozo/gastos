"use client";

// Gastos (design 4b): filters, inline dashed add row, day-grouped or flat
// list, inline edit and delete per row.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

import {
  useAuth,
  useHousehold,
  useLocale,
  useUserDoc,
} from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/avatar";
import { Segmented } from "@/components/ui/segmented";
import {
  BudgetCurrencyControls,
  entryToAudCents,
  useBudgetCurrency,
  type EntryCurrency,
} from "@/components/budget-amount-field";
import { useExpensesRange } from "@/lib/firebase/hooks";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  addExpense,
  deleteExpense,
  updateExpense,
  type ExpenseInput,
} from "@/lib/firebase/mutations";
import type { Expense, Household, PeriodBudget } from "@/lib/firebase/converters";
import { categoryCircleBg, categoryColor, type CategoryDef } from "@/lib/categories";
import {
  formatApproxUsd,
  formatCents,
  formatCentsCompact,
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
  currency,
  onCurrencyChange,
  usdRate,
  locale,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  categories: SortedCategory[];
  amountRef?: React.RefObject<HTMLInputElement | null>;
  /** Most frequent recent notes offered as native autocomplete options. */
  noteSuggestions?: string[];
  /** Bi-currency entry toggle state (AUD default, USD converts on save). */
  currency: EntryCurrency;
  onCurrencyChange: (currency: EntryCurrency) => void;
  usdRate: number | null;
  locale: string;
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
      {/* AUD | USD toggle + live ≈ conversion; renders nothing without an FX
          rate, so entry falls back to AUD-only exactly as before. */}
      <BudgetCurrencyControls
        amount={form.amount}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
        usdRate={usdRate}
        locale={locale}
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

/** Turn a typed entry-row amount into the ExpenseInput money fields: always
 * canonical AUD `amountCents`, plus the USD original when the row is in USD.
 * Returns null when the amount can't be parsed (or USD without a rate). */
function buildAmountFields(
  amount: string,
  currency: EntryCurrency,
  usdRate: number | null,
): Pick<
  ExpenseInput,
  "amountCents" | "entryCurrency" | "entryAmountCents"
> | null {
  const amountCents = entryToAudCents(amount, currency, usdRate);
  if (amountCents === null) return null;
  if (currency === "USD") {
    const usdCents = parseAmountToCents(amount);
    if (usdCents === null) return null;
    return { amountCents, entryCurrency: "USD", entryAmountCents: usdCents };
  }
  return { amountCents };
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ExpensesPage() {
  const t = useTranslations("expenses");
  const tEmpty = useTranslations("empty");
  const tDash = useTranslations("dashboard");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { userDoc } = useUserDoc();
  const { household, periods, currentPeriod, today } = useHousehold();

  const [grouped, setGrouped] = useState<"grouped" | "flat">("grouped");
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Bi-currency entry: one toggle for the add row, one for the edit row. The
  // daily FX rate is fetched once (cached); when it's null the toggle hides
  // and entry behaves exactly as AUD-only.
  const {
    currency: addCurrency,
    setCurrency: setAddCurrency,
    usdRate,
  } = useBudgetCurrency();
  const {
    currency: editCurrency,
    setCurrency: setEditCurrency,
    usdRate: editUsdRate,
  } = useBudgetCurrency();

  // Seed the add row from the user's preferred entry currency once it loads —
  // never clobbering a choice already made on the row this session.
  const addCurrencyInit = useRef(false);
  useEffect(() => {
    if (addCurrencyInit.current || userDoc === null) return;
    addCurrencyInit.current = true;
    setAddCurrency(userDoc.defaultEntryCurrency ?? "AUD");
  }, [userDoc, setAddCurrency]);

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

  /* Bi-currency: with no FX rate the toggle is hidden, so force AUD. */
  const addEntryCurrency: EntryCurrency = usdRate === null ? "AUD" : addCurrency;
  const editEntryCurrency: EntryCurrency =
    editUsdRate === null ? "AUD" : editCurrency;

  /* Mutations */
  const submitAdd = async () => {
    const fb = getFirebaseClient();
    const money = buildAmountFields(
      effectiveAddForm.amount,
      addEntryCurrency,
      usdRate,
    );
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
    // Edit a USD-entered expense in USD (showing the original) only when a
    // rate is available; otherwise fall back to editing the canonical AUD.
    const asUsd =
      e.entryCurrency === "USD" &&
      e.entryAmountCents !== undefined &&
      editUsdRate !== null;
    const shownCents = asUsd ? e.entryAmountCents! : e.amountCents;
    setEditingId(e.id);
    setEditCurrency(asUsd ? "USD" : "AUD");
    setEditForm({
      amount: (shownCents / 100).toLocaleString(
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
    const money = buildAmountFields(
      editForm.amount,
      editEntryCurrency,
      editUsdRate,
    );
    if (money === null || editForm.date === "") return;
    const input: ExpenseInput = {
      ...money,
      categoryId: editForm.categoryId,
      note: editForm.note.trim(),
      date: editForm.date,
    };
    setSaving(true);
    try {
      await updateExpense(fb.db, household.id, editingId, input);
      setEditingId(null);
      setEditForm(null);
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
    if (editingId === e.id && editForm !== null) {
      return (
        <div key={e.id} className="flex flex-wrap items-center gap-3 py-[9px]">
          <ExpenseFormFields
            form={editForm}
            setForm={setEditForm}
            categories={categories}
            noteSuggestions={noteSuggestions}
            currency={editCurrency}
            onCurrencyChange={setEditCurrency}
            usdRate={editUsdRate}
            locale={locale}
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

    const def = household.categories[e.categoryId];
    // Deleted category: neutral icon (below) + a readable label, never the
    // raw doc id.
    const catLabel =
      categories.find((c) => c.id === e.categoryId)?.label ?? tCat("deleted");
    const profile = household.memberProfiles[e.createdBy];
    return (
      <div
        key={e.id}
        className={`grid items-center gap-3 py-[9px] ${
          // Below lg (iPad portrait) the category/date columns are hidden and
          // the note takes the remaining space — the full grid needs ~900px.
          flat
            ? "grid-cols-[44px_minmax(0,1fr)_34px_auto_76px] lg:grid-cols-[44px_1.6fr_1fr_90px_120px_110px_76px]"
            : "grid-cols-[44px_minmax(0,1fr)_34px_auto_76px] lg:grid-cols-[44px_1.6fr_1fr_120px_110px_76px]"
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
        <span className="truncate text-sm font-semibold text-ink">
          {e.note !== "" ? e.note : catLabel}
        </span>
        <span className="hidden truncate text-[13px] text-ink-2 lg:block">
          {catLabel}
        </span>
        {flat && (
          <span className="tnum hidden text-[13px] text-ink-2 lg:block">
            {formatShortDate(e.date, locale)}
          </span>
        )}
        <div className="flex items-center gap-[7px]">
          {profile !== undefined && (
            <Avatar
              name={profile.displayName}
              color={profile.color}
              size={22}
            />
          )}
        </div>
        {e.entryCurrency === "USD" && e.entryAmountCents !== undefined ? (
          // Canonical AUD stays the bold figure (every total reads it); the
          // originally entered USD shows beneath it, ≈-style like the badges.
          <div className="flex flex-col items-end leading-tight">
            <span className="tnum text-sm font-bold text-ink">
              {formatCents(e.amountCents, household.currency, locale)}
            </span>
            <span className="tnum text-[11px] font-semibold text-ink-3">
              {formatApproxUsd(e.entryAmountCents, locale)}
            </span>
          </div>
        ) : (
          <span className="tnum text-right text-sm font-bold text-ink">
            {formatCents(e.amountCents, household.currency, locale)}
          </span>
        )}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            aria-label={t("edit")}
            onClick={() => startEdit(e)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
            style={{ background: "rgba(42,111,219,.1)" }}
          >
            <Icon name="edit" size={15} style={{ color: "var(--member-blue)" }} />
          </button>
          <button
            type="button"
            aria-label={t("delete")}
            onClick={() => void removeExpense(e)}
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
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="flex items-center gap-1.5 rounded-full border border-pill bg-surface px-3 py-[5px] disabled:opacity-40"
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

      {/* Inline add row */}
      <div
        className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-2.5"
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
            currency={addCurrency}
            onCurrencyChange={setAddCurrency}
            usdRate={usdRate}
            locale={locale}
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
              className="rounded-full bg-accent px-[13px] py-1.5 text-xs font-bold text-white"
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
