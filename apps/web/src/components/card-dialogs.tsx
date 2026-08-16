"use client";

// The two dialogs the Tarjetas screen needs: one for a charge, one for the
// dates of a statement.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { CardMark } from "@/components/ui/marks";
import type { CardCharge } from "@/lib/firebase/converters";
import type { CardChargeInput } from "@/lib/firebase/mutations";
import { formatLongDate } from "@/lib/dates";
import { formatUsd, parseAmountToCents } from "@/lib/money";
import { CARD_BRANDS, type CardBrand, type StatementRange } from "@/lib/statements";

const FIELD =
  "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent";

const SHELL =
  "flex max-h-[92vh] w-full max-w-[440px] flex-col gap-3.5 overflow-y-auto rounded-t-[24px] border border-line bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[24px]";

/** Escape closes, like every other dialog in the app. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/* ── A charge ──────────────────────────────────────────────────────────── */

export function CardChargeDialog({
  charge,
  defaultDate,
  locale,
  onSave,
  onDelete,
  onClose,
}: {
  /** Null when adding. */
  charge: CardCharge | null;
  defaultDate: string;
  locale: string;
  onSave: (input: CardChargeInput) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const t = useTranslations("cards");
  const tCommon = useTranslations("expenses");
  useEscape(onClose);

  const [date, setDate] = useState(charge?.date ?? defaultDate);
  const [detail, setDetail] = useState(charge?.detail ?? "");
  const [brand, setBrand] = useState<CardBrand>(charge?.card ?? "visa");
  const [amount, setAmount] = useState(
    charge !== null ? (charge.usdCents / 100).toFixed(2) : "",
  );

  const usdCents = parseAmountToCents(amount);
  const valid = usdCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={charge === null ? t("addCharge") : t("editCharge")}
        onClick={(event) => event.stopPropagation()}
        className={SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">
            {charge === null ? t("addCharge") : t("editCharge")}
          </h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {/* USD only: this is the card's own billing currency, so there is no
            currency to choose and nothing to convert. */}
        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("amountUsd")}</span>
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={`${FIELD} tnum`}
          />
          {usdCents !== null && (
            <span className="tnum text-[11.5px] text-ink-3">
              {formatUsd(usdCents, locale)}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("detail")}</span>
          <input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={200}
            placeholder={t("detailPlaceholder")}
            className={FIELD}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="section-label">{t("date")}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={FIELD}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="section-label">{t("card")}</span>
            <div className="flex gap-2">
              {CARD_BRANDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={brand === value}
                  onClick={() => setBrand(value)}
                  className={`flex flex-1 items-center justify-center rounded-xl border py-2 ${
                    brand === value
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-bg"
                  }`}
                >
                  <CardMark brand={value} size={30} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-2.5">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (usdCents === null) return;
              onSave({ date, detail: detail.trim(), card: brand, usdCents });
            }}
            className="flex-1 rounded-full bg-accent py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {tCommon("save")}
          </button>
          {onDelete !== null && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full border border-line px-4 py-3 text-sm font-semibold"
              style={{ color: "var(--over)" }}
            >
              {tCommon("delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── A statement's dates ───────────────────────────────────────────────── */

/**
 * Closing and due dates for the statement being opened. Both are proposed a
 * month on from the previous one — banks usually keep the day of the month —
 * but both are editable, which is the whole reason this asks instead of
 * assuming.
 */
export function StatementDatesDialog({
  proposal,
  /** The statement being closed, if any — shown so the window is obvious. */
  closing,
  locale,
  onSave,
  onClose,
}: {
  proposal: StatementRange;
  closing: StatementRange | null;
  locale: string;
  onSave: (range: StatementRange) => void;
  onClose: () => void;
}) {
  const t = useTranslations("cards");
  const tCommon = useTranslations("expenses");
  useEscape(onClose);

  const [closingDate, setClosingDate] = useState(proposal.closingDate);
  const [dueDate, setDueDate] = useState(proposal.dueDate);
  /** Second press on the primary action. Only ever true when a statement is
   * actually being closed — see `confirms` below. */
  const [confirming, setConfirming] = useState(false);

  // The bill cannot be payable before it closes — the rules refuse it too.
  const ordered = dueDate > closingDate;
  const startsBefore = proposal.startDate <= closingDate;
  const valid = ordered && startsBefore && closingDate !== "" && dueDate !== "";

  // Confirm only when something is being closed. Opening the FIRST statement
  // runs through this same dialog and closes nothing, so asking "are you sure"
  // there would be a prompt with no consequence behind it.
  const confirms = closing !== null;

  const primary = () => {
    if (confirms && !confirming) {
      setConfirming(true);
      return;
    }
    onSave({ startDate: proposal.startDate, closingDate, dueDate });
  };

  // Editing the dates after asking makes the question stale — it named a date.
  const editDate = (set: (value: string) => void) => (value: string) => {
    setConfirming(false);
    set(value);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("newStatement")}
        onClick={(event) => event.stopPropagation()}
        className={SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">{t("newStatement")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        <p className="text-[12.5px] text-ink-2">
          {closing !== null
            ? t("closingHint", {
                date: formatLongDate(closing.closingDate, locale),
              })
            : t("firstStatementHint")}
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("closingDate")}</span>
          <input
            type="date"
            value={closingDate}
            onChange={(e) => editDate(setClosingDate)(e.target.value)}
            className={FIELD}
          />
          <span className="text-[11.5px] text-ink-3">{t("closingDateHelp")}</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("dueDate")}</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => editDate(setDueDate)(e.target.value)}
            className={FIELD}
          />
          <span className="text-[11.5px] text-ink-3">{t("dueDateHelp")}</span>
        </label>

        {!ordered && (
          <p className="text-[11.5px] font-semibold" style={{ color: "var(--over)" }}>
            {t("dueAfterClosing")}
          </p>
        )}

        {confirming && closing !== null && (
          // Names both dates: the question is only worth asking if it says
          // exactly what is about to happen.
          <p
            className="rounded-[12px] bg-warn-bg px-3 py-2.5 text-[12px] leading-snug font-semibold"
            style={{ color: "var(--warn-text)" }}
            role="alert"
          >
            {t("confirmClose", {
              closing: formatLongDate(closing.closingDate, locale),
              opening: formatLongDate(closingDate, locale),
            })}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2.5">
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-line px-4 py-3 text-[13px] font-semibold text-ink-2"
            >
              {tCommon("cancel")}
            </button>
          )}
          <button
            type="button"
            disabled={!valid}
            onClick={primary}
            className="flex-1 rounded-full bg-accent py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {confirming
              ? t("confirmCloseCta")
              : confirms
                ? t("closeAndOpen")
                : t("openStatement")}
          </button>
        </div>
      </div>
    </div>
  );
}
