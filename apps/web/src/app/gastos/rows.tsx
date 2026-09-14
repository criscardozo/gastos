import { formatCents, parseAmountToCents } from "@/lib/money";
import type { Expense, Household } from "@/lib/firebase/converters";
import { ExpenseFormFields, type FormState } from "./pieces";

/**
 * The two rows an expense turns into while it is being ACTED on.
 *
 * They came out of a single `renderRow` that rendered three shapes behind one
 * name and needed EIGHTEEN values from the page to do it. That number is what
 * made the obvious split — lift the whole renderer — cost more than it bought:
 * eighteen props threaded through is harder to read than the long function was.
 *
 * Split by mode instead and each piece takes six. The count was the symptom;
 * three things wearing one name was the cause.
 *
 * The plain row stays in the page for now: it is the only one of the three that
 * is not a form, and it reaches for the row actions rather than being handed
 * them.
 */

export function VerifyExpenseRow({
  expense,
  household,
  locale,
  catLabel,
  verifyAmount,
  setVerifyAmount,
  submitVerify,
  cancelVerify,
  t,
}: {
  expense: Expense;
  household: Household;
  locale: string;
  /** Already resolved by the page: a deleted category still needs a name. */
  catLabel: string;
  verifyAmount: string;
  setVerifyAmount: (v: string) => void;
  submitVerify: (usdCents: number | null) => void;
  cancelVerify: () => void;
  t: (key: string) => string;
}) {
  const e = expense;
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
        onClick={cancelVerify}
        className="text-[13px] font-semibold text-ink-2"
      >
        {t("cancel")}
      </button>
    </div>
  );
}

export function EditExpenseRow({
  expense,
  editForm,
  setEditForm,
  categories,
  noteSuggestions,
  submitEdit,
  cancelEdit,
  t,
}: {
  expense: Expense;
  editForm: FormState;
  setEditForm: (f: FormState | null) => void;
  categories: Parameters<typeof ExpenseFormFields>[0]["categories"];
  noteSuggestions: string[];
  submitEdit: () => void;
  cancelEdit: () => void;
  t: (key: string) => string;
}) {
  const e = expense;
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
        onClick={cancelEdit}
        className="text-[13px] font-semibold text-ink-2"
      >
        {t("cancel")}
      </button>
    </div>
  );
}
