"use client";

/**
 * The pieces the expenses screen is built from: the two filter controls, the
 * category ordering it reads, and the fields shared by the add row and the
 * edit dialog.
 *
 * Split out of page.tsx, which was 992 lines and where these sat above the
 * component that used them — so reading the screen meant scrolling past a
 * pill's markup to reach the logic. Nothing here changed.
 */

import { useId, useMemo, type ChangeEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { parseAmountToCents } from "@/lib/money";
import type { ExpenseInput } from "@/lib/firebase/mutations";
import type { Household } from "@/lib/firebase/converters";
import type { CategoryDef } from "@/lib/categories";
import { MAX_NOTE_CHARACTERS } from "@/lib/limits";

export function FilterPill({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex items-center gap-1.5 rounded-full border border-pill bg-surface px-3.5 py-2">
      {children}
    </div>
  );
}

export function PillSelect({
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

export function useSortedCategories(household: Household): SortedCategory[] {
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

export interface FormState {
  amount: string;
  categoryId: string;
  note: string;
  date: string;
}

export function ExpenseFormFields({
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
        maxLength={MAX_NOTE_CHARACTERS}
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
export type VerificationFilter = "all" | "unverified" | "verified";

/** Typed amount → the expense's AUD cents, or null when unparsable. */
export function buildAmountFields(
  amount: string,
  locale: string,
): Pick<ExpenseInput, "amountCents"> | null {
  const amountCents = parseAmountToCents(amount, locale);
  return amountCents === null ? null : { amountCents };
}
