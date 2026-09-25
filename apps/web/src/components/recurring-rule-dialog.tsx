"use client";

// Add or edit a recurring-expense rule.
//
// The one field worth explaining is the amount, and the explanation is that
// LEAVING IT EMPTY IS A CHOICE: a rule with an amount files the charge on its
// own, one without can only annotate it and ask. So the field is not optional
// in the "you may skip this" sense — the two states do different things, and
// the help text says which.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import type { Household, RecurringRuleDoc } from "@/lib/firebase/converters";
import type { RecurringRuleInput } from "@/lib/firebase/mutations";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { matchesPattern } from "@/lib/recurring";
import {
  ServiceNoteField,
  serviceNoteValid,
} from "@/components/service-note-field";
import { DIALOG_SHELL } from "@/components/ui/dialog-shell";

/**
 * "OPAL AUCKLAND ST" → "Opal Auckland St".
 *
 * Only for the NOTE, which is what shows in Historial — the bank shouts and a
 * ledger should not. The pattern is left exactly as the bank writes it,
 * because that one has to match.
 */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, sep, first) => sep + first.toUpperCase());
}

/** Integer cents back to an editable string ("1500" → "15,00"). */
function centsToInput(cents: number | null, locale: string): string {
  if (cents === null) return "";
  return formatCents(cents, "AUD", locale).replace(/[^\d.,]/g, "");
}

export function RecurringRuleDialog({
  rule,
  household,
  locale,
  /** Merchants of the charges still waiting, so the pattern can be tried. */
  pendingMerchants,
  /**
   * The household's services, for the note when the category is Servicios.
   *
   * Servicios links a service to its charge by NAME — an expense filed in that
   * category whose note is the service's name IS that month's charge. A rule
   * already picks the note of what it files, so a rule can close a service's
   * month on its own; nothing new was needed for that. What WAS needed is
   * this: the note is seeded with the merchant ("Google Youtubepremium"),
   * which is right for an Opal top-up and is exactly wrong here, and a typo
   * fails the same way — silently. The expense is filed, correct, and the
   * service goes on saying it was never charged. So when the category is
   * Servicios the note stops being free text and becomes the list.
   */
  services,
  seed,
  onSave,
  onDelete,
  onClose,
}: {
  /** Null when adding. */
  rule: RecurringRuleDoc | null;
  household: Household;
  locale: string;
  pendingMerchants: readonly string[];
  services: readonly { id: string; name: string }[];
  /**
   * Pre-fill from the charge this was opened over: the merchant as the bank
   * spells it, and what it charged.
   *
   * The pattern starts as the WHOLE merchant rather than a guess at the stem.
   * "OPAL AUCKLAND ST" is too specific to be useful as a rule, but it is
   * right, and trimming it to "Opal" is a one-second edit — whereas a clever
   * guess that silently drops the wrong half is a rule that never fires and
   * says nothing about why.
   *
   * The amount is deliberately NOT seeded from the USD figure: that is what
   * the bank charged in dollars, and the rule's amount is AUD. Filling it with
   * a number in the wrong currency would be worse than leaving it empty.
   */
  seed?: { merchant: string; usdCents: number };
  onSave: (input: RecurringRuleInput) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const t = useTranslations("recurring");
  const tCommon = useTranslations("expenses");
  const tCat = useTranslations("categories");

  const [pattern, setPattern] = useState(rule?.pattern ?? seed?.merchant ?? "");
  const [note, setNote] = useState(
    rule?.note ?? (seed === undefined ? "" : titleCase(seed.merchant)),
  );
  const [categoryId, setCategoryId] = useState(
    rule?.categoryId ?? Object.keys(household.categories)[0] ?? "",
  );
  const [asks, setAsks] = useState(rule === null || rule.amountAudCents === null);
  const [amount, setAmount] = useState(
    centsToInput(rule?.amountAudCents ?? null, locale),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The note becomes the list of services when the category is Servicios.
  // Why, and why it is refused rather than warned about, is in
  // components/service-note-field.tsx — both dialogs that can file into
  // Servicios share it, because both seeded the note with the merchant and
  // both had the same silent hole.
  const [writesOwnNote, setWritesOwnNote] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cents = parseAmountToCents(amount, locale);
  const valid =
    pattern.trim() !== "" &&
    note.trim() !== "" &&
    categoryId !== "" &&
    // In list mode the note has to BE one of the services. This is the guard
    // the whole change exists for: saving a Servicios rule whose note matches
    // nothing is the silent failure, so it is refused rather than warned
    // about.
    serviceNoteValid(categoryId, note, services, writesOwnNote) &&
    (asks || cents !== null);

  // What the pattern would claim RIGHT NOW, out of the charges still waiting.
  //
  // A pattern is guesswork until you see it hit something. Typing it blind and
  // finding out days later that it never matched — or matched everything — is
  // the failure this avoids, and the charges are already on screen behind the
  // dialog.
  const hits = pendingMerchants.filter((m) => matchesPattern(pattern, m));

  const categories = Object.entries(household.categories).sort(
    ([, a], [, b]) => a.sortOrder - b.sortOrder,
  );
  const label = (id: string) => {
    const def = household.categories[id];
    if (def === undefined) return id;
    return def.key !== undefined ? tCat(def.key) : def.name;
  };

  const field =
    "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent";

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
        className={DIALOG_SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("title")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("pattern")}</span>
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t("patternPlaceholder")}
            maxLength={80}
            className={field}
          />
          <span className="text-[11.5px] text-ink-3">{t("patternHelp")}</span>
          {/* Live, because a pattern you cannot try is a guess you find out
              about days later. */}
          <span className="text-[11.5px] font-semibold text-ink-2">
            {pattern.trim() === ""
              ? ""
              : hits.length === 0
                ? t("matchesNone")
                : `${t("matches", { count: hits.length })} — ${hits.slice(0, 2).join(", ")}`}
          </span>
        </label>

        <ServiceNoteField
          categoryId={categoryId}
          note={note}
          onNote={setNote}
          services={services}
          writesOwnNote={writesOwnNote}
          onWritesOwnNote={setWritesOwnNote}
          className={field}
          plainLabel={t("note")}
        />

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("category")}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={field}
          >
            {categories.map(([id]) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="section-label">{t("amount")}</span>
          <Segmented
            value={asks ? "ask" : "fixed"}
            onChange={(v) => setAsks(v === "ask")}
            options={[
              { value: "fixed", label: t("amount") },
              { value: "ask", label: t("amountAsk") },
            ]}
          />
          {!asks && (
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              aria-label={t("amount")}
              className={`${field} tnum`}
            />
          )}
          <span className="text-[11.5px] text-ink-3">{t("amountHelp")}</span>
        </div>

        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            onSave({
              pattern: pattern.trim(),
              categoryId,
              note: note.trim(),
              amountAudCents: asks ? null : cents,
            });
          }}
          className="rounded-full bg-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-45"
        >
          {t("save")}
        </button>

        {onDelete !== null && (
          <button
            type="button"
            onClick={() => {
              if (confirmDelete) onDelete();
              else setConfirmDelete(true);
            }}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-over-text"
          >
            {confirmDelete ? t("deleteConfirm") : t("delete")}
          </button>
        )}
      </div>
    </div>
  );
}
