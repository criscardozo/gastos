"use client";

// The note of an expense filed in the Servicios category, chosen rather than
// typed.
//
// Servicios links a service to its charge by NAME: an expense in that category
// whose note folds to a service's name IS that month's charge (see
// lib/services.ts). Nothing is stored on either document, which is what makes
// renaming a service safe — and also what makes a typo silent. The expense is
// filed, correct, and the service goes on saying it was never charged.
//
// Both dialogs that can file into Servicios use this: the recurring rule and
// "Crear gasto" from a charge. Both seed the note with the merchant, which is
// right for a shop and is exactly wrong for a bill, so both had the same hole.

import { useTranslations } from "next-intl";

import { MAX_NOTE_CHARACTERS } from "@/lib/limits";
import { SERVICES_CATEGORY_ID, nameKey } from "@/lib/services";

export interface ServiceOption {
  id: string;
  name: string;
}

/**
 * Whether this note may be saved.
 *
 * Refused rather than warned about: a Servicios note matching no service is
 * the failure nobody notices, so it does not get to be a warning somebody
 * clicks past.
 */
export function serviceNoteValid(
  categoryId: string,
  note: string,
  services: readonly ServiceOption[],
  writesOwnNote: boolean,
): boolean {
  if (categoryId !== SERVICES_CATEGORY_ID || services.length === 0) return true;
  if (writesOwnNote) return note.trim() !== "";
  return services.some((s) => nameKey(s.name) === nameKey(note));
}

export function ServiceNoteField({
  categoryId,
  note,
  onNote,
  services,
  writesOwnNote,
  onWritesOwnNote,
  className,
  /**
   * What to call the plain field, from the OWNING dialog's namespace.
   *
   * Not `t("note")` from here: the two dialogs word it differently ("Nota" in
   * Crear gasto, "Cómo se llama el gasto" in the rule editor), and taking one
   * of them silently renamed the other's field — which an e2e assertion on the
   * accessible name caught, because that name is what a screen reader says.
   */
  plainLabel,
}: {
  categoryId: string;
  note: string;
  onNote: (note: string) => void;
  services: readonly ServiceOption[];
  /** Sticky: only an explicit "write it myself" leaves the list. */
  writesOwnNote: boolean;
  onWritesOwnNote: (own: boolean) => void;
  className: string;
  plainLabel: string;
}) {
  const t = useTranslations("recurring");
  const picksService =
    categoryId === SERVICES_CATEGORY_ID && services.length > 0;
  const usesList = picksService && !writesOwnNote;
  const matched = services.find((s) => nameKey(s.name) === nameKey(note)) ?? null;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="section-label">
        {picksService ? t("noteService") : plainLabel}
      </span>
      {picksService && (
        <select
          value={usesList ? (matched?.id ?? "") : "__other"}
          aria-label={t("noteService")}
          onChange={(event) => {
            if (event.target.value === "__other") {
              onWritesOwnNote(true);
              return;
            }
            onWritesOwnNote(false);
            const picked = services.find((s) => s.id === event.target.value);
            // The name VERBATIM. Typing it is what breaks the link, so the one
            // thing this control must never do is hand back something the user
            // could have typed.
            if (picked !== undefined) onNote(picked.name);
          }}
          className={className}
        >
          {/* Unselected, ALWAYS, when the note is not a service — including a
              note seeded with the merchant, which is the case this exists for.
              An empty list is what says a choice is owed; falling back to free
              text would leave the merchant sitting there looking answered. */}
          {usesList && matched === null && (
            <option value="">{t("noteServicePick")}</option>
          )}
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
          <option value="__other">{t("noteServiceOther")}</option>
        </select>
      )}
      {!usesList && (
        <input
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder={t("notePlaceholder")}
          aria-label={plainLabel}
          maxLength={MAX_NOTE_CHARACTERS}
          className={className}
        />
      )}
      {picksService && (
        <span className="text-[11.5px] text-ink-3">
          {usesList ? t("noteServiceHelp") : t("noteServiceOtherHelp")}
        </span>
      )}
    </label>
  );
}
