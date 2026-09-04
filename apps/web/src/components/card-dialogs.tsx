"use client";

// The two dialogs the Tarjetas screen needs: one for a charge, one for the
// dates of a statement.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { CardMark } from "@/components/ui/marks";
import type { CardCharge, CardFeeSettings } from "@/lib/firebase/converters";
import type { CardChargeInput } from "@/lib/firebase/mutations";
import { formatLongDate } from "@/lib/dates";
import { formatUsd, parseAmountToCents } from "@/lib/money";
import { CARD_BRANDS, type CardBrand, type StatementRange } from "@/lib/statements";

/** The peso ceiling the security rules enforce on both `cardFees` fields. */
const ARS_MAX_CENTS = 100_000_000;

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
  pastClosing,
  locale,
  onSave,
  onDelete,
  onClose,
}: {
  /** Null when adding. */
  charge: CardCharge | null;
  defaultDate: string;
  /**
   * Set when today is already past the statement's closing date, so the charge
   * is about to be filed under a window it does not belong to. Null the rest of
   * the time, which is nearly always.
   */
  pastClosing: { closingDate: string; today: string } | null;
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
  // Defaults to on: nearly everything that goes on this card is a digital
  // service, and the two taxes that depend on it are the ones people forget.
  const [digital, setDigital] = useState(charge?.digital ?? true);
  const [amount, setAmount] = useState(
    charge !== null ? (charge.usdCents / 100).toFixed(2) : "",
  );

  const usdCents = parseAmountToCents(amount, locale);
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
          <h2 className="text-base font-bold text-ink">
            {charge === null ? t("addCharge") : t("editCharge")}
          </h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        {pastClosing !== null && (
          // Says what happened and what to do about it, rather than blocking:
          // a charge made after the closing date is perfectly real, it just
          // belongs to the next statement. Both dates are named because the
          // whole point is that they disagree.
          <p
            className="rounded-[12px] bg-warn-bg px-3 py-2.5 text-[12px] leading-snug font-semibold"
            style={{ color: "var(--warn-text)" }}
            role="alert"
          >
            {t("pastClosingBody", {
              date: formatLongDate(pastClosing.closingDate, locale),
              today: formatLongDate(pastClosing.today, locale),
            })}
          </p>
        )}

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

        {/* Which taxes it attracts: RG 5617 falls on everything, IIBB and
            RG 4240 only on digital services from abroad. The bank decides from
            how the merchant is registered, so it has to be told rather than
            worked out — a ride-share app is one, a shop is not. */}
        <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-ink">
              {t("digital")}
            </span>
            <span className="text-[11.5px] text-ink-3">{t("digitalHelp")}</span>
          </span>
          <input
            type="checkbox"
            checked={digital}
            onChange={(e) => setDigital(e.target.checked)}
            className="size-[18px] flex-none accent-[var(--accent)]"
          />
        </label>

        <div className="mt-1 flex items-center gap-2.5">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (usdCents === null) return;
              onSave({ date, detail: detail.trim(), card: brand, usdCents, digital });
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
  /** Charges on it that nobody ticked off against the paper bill. */
  unverifiedCount,
  locale,
  onSave,
  onClose,
}: {
  proposal: StatementRange;
  closing: StatementRange | null;
  unverifiedCount: number;
  locale: string;
  onSave: (range: StatementRange, moveUnverified: boolean) => void;
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
  /**
   * Carry the unverified charges over. On by default: an unticked charge is one
   * nobody could find on the paper bill, and the reason is usually that the
   * bank posted it after the closing date. Leaving it behind puts it in a
   * statement it was never on.
   */
  const [moveUnverified, setMoveUnverified] = useState(true);

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
    onSave(
      { startDate: proposal.startDate, closingDate, dueDate },
      moveUnverified && unverifiedCount > 0,
    );
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
          <h2 className="text-base font-bold text-ink">{t("newStatement")}</h2>
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

        {/* Only when something is actually being closed, and only when there
            is something to carry. Says what it does to the data, because it
            re-dates the charges — there is no statement id to move instead. */}
        {closing !== null && unverifiedCount > 0 && (
          <label className="flex items-start gap-2.5 rounded-[14px] border border-line bg-bg px-3.5 py-3">
            <input
              type="checkbox"
              checked={moveUnverified}
              onChange={(e) => setMoveUnverified(e.target.checked)}
              className="mt-px size-4 flex-none accent-[var(--accent)]"
            />
            <span className="flex flex-col gap-px">
              <span className="text-[13px] font-bold text-ink">
                {t("moveUnverified", { count: unverifiedCount })}
              </span>
              <span className="text-[11.5px] text-ink-3">
                {t("moveUnverifiedHint", {
                  date: formatLongDate(proposal.startDate, locale),
                })}
              </span>
            </span>
          </label>
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

/* ── The peso side: the bank's fixed fee and a fallback rate ────────────── */

export function CardFeesDialog({
  fees,
  locale,
  onSave,
  onClose,
}: {
  fees: CardFeeSettings;
  locale: string;
  onSave: (fees: CardFeeSettings) => void;
  onClose: () => void;
}) {
  const t = useTranslations("cards");
  const tCommon = useTranslations("expenses");
  useEscape(onClose);

  const [commission, setCommission] = useState(
    fees.commissionArsCents > 0 ? (fees.commissionArsCents / 100).toFixed(2) : "",
  );
  const [rate, setRate] = useState(
    fees.usdArsRate !== null ? String(fees.usdArsRate) : "",
  );

  // Both fields are optional — a household may know the fee before the rate, or
  // want to clear either — so EMPTY means "not configured". Anything typed has
  // to parse, though: unparseable input must not fall through to the same
  // result as an empty box, which would silently wipe the stored value.
  //
  // The ledger's ceiling does not apply here: these are pesos, three orders of
  // magnitude away from an AUD expense. ARS_MAX is what the rules accept.
  const typedCommission = commission.trim() !== "";
  const typedRate = rate.trim() !== "";
  const commissionCents = typedCommission
    ? parseAmountToCents(commission, locale, ARS_MAX_CENTS)
    : 0;
  const rateCents = typedRate
    ? parseAmountToCents(rate, locale, ARS_MAX_CENTS)
    : null;
  const valid =
    commissionCents !== null && (!typedRate || rateCents !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("arsSettings")}
        onClick={(event) => event.stopPropagation()}
        className={SHELL}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("arsSettings")}</h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("commission")}</span>
          <input
            autoFocus
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={`${FIELD} tnum`}
          />
          <span className="text-[11.5px] text-ink-3">{t("commissionHelp")}</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("fallbackRate")}</span>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder="1514,50"
            className={`${FIELD} tnum`}
          />
          <span className="text-[11.5px] text-ink-3">{t("fallbackRateHelp")}</span>
        </label>

        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (!valid || commissionCents === null) return;
            onSave({
              commissionArsCents: commissionCents,
              // Parsed as cents to reuse the locale-aware parser, then divided
              // back: a rate is a plain number, not money.
              usdArsRate: rateCents === null ? null : rateCents / 100,
            });
          }}
          className="mt-1 rounded-full bg-accent py-3 text-sm font-bold text-white disabled:opacity-40"
        >
          {tCommon("save")}
        </button>
      </div>
    </div>
  );
}
