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
import { MAX_NOTE_CHARACTERS } from "@/lib/limits";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { matchesPattern } from "@/lib/recurring";
import { SERVICES_CATEGORY_ID, nameKey } from "@/lib/services";
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

  // Servicios mode: the note comes from the list, unless the household has no
  // services yet (then there is no list to pick from and free text is all
  // there is) or the note deliberately is not one of them.
  const picksService = categoryId === SERVICES_CATEGORY_ID && services.length > 0;
  const matchedService =
    services.find((s) => nameKey(s.name) === nameKey(note)) ?? null;
  // "Write it myself" is a real answer, not an escape hatch for a bug: a rule
  // in Servicios can legitimately be for something the household never
  // registered as a service.
  //
  // The list is the default in Servicios, ALWAYS, and only an explicit "write
  // it myself" leaves it.
  //
  // The first version of this derived the mode from the note — free text
  // whenever the note was not a service — and that is wrong in the exact case
  // this exists for. The note arrives seeded with the merchant, so
  // "GOOGLE YOUTUBEPREMIUM" derives to free text holding "Google
  // Youtubepremium", which looks fine, saves fine, and never links: the
  // failure is unchanged and now has a control that looks like it addressed
  // it. Showing the list UNSELECTED instead is what says a choice is owed.
  //
  // The same is true of editing an old rule whose note is not a service: it
  // opens on an empty list, which is not a nuisance but the answer to "why is
  // this one not marking the service as charged".
  const [chosen, setChosen] = useState<"list" | "other" | null>(null);
  const usesList = picksService && chosen !== "other";

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
    (!usesList || matchedService !== null) &&
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

        <label className="flex flex-col gap-1.5">
          <span className="section-label">
            {picksService ? t("noteService") : t("note")}
          </span>
          {picksService && (
            <select
              value={usesList ? (matchedService?.id ?? "") : "__other"}
              aria-label={t("noteService")}
              onChange={(e) => {
                if (e.target.value === "__other") {
                  setChosen("other");
                  return;
                }
                setChosen("list");
                const picked = services.find((s) => s.id === e.target.value);
                // The service's name VERBATIM. Typing it is what breaks the
                // link, so the one thing this control must never do is hand
                // back something the user could have typed.
                if (picked !== undefined) setNote(picked.name);
              }}
              className={field}
            >
              {usesList && matchedService === null && (
                <option value="">{t("noteServicePick")}</option>
              )}
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="__other">{t("noteServiceOther")}</option>
            </select>
          )}
          {!usesList && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              aria-label={t("note")}
              maxLength={MAX_NOTE_CHARACTERS}
              className={field}
            />
          )}
          {picksService && (
            <span className="text-[11.5px] text-ink-3">
              {usesList ? t("noteServiceHelp") : t("noteServiceOtherHelp")}
            </span>
          )}
        </label>

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
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-red"
          >
            {confirmDelete ? t("deleteConfirm") : t("delete")}
          </button>
        )}
      </div>
    </div>
  );
}
