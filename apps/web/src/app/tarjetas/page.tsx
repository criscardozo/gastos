"use client";

// Tarjetas de Crédito: what went on the cards, grouped into the statement it
// belongs to.
//
// A statement is a window with two dates that mean different things — the
// CLOSING date is the last day a charge enters it, the DUE date is the last day
// it can be paid. Charges are bucketed by their own date, exactly as expenses
// are bucketed into periods, so nothing has to be re-pointed when a statement
// is opened, corrected or deleted.
//
// Everything is USD, because that is what the card bills in. This screen never
// touches the household budget.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { CardMark, CARD_LABELS } from "@/components/ui/marks";
import {
  CardChargeDialog,
  CardFeesDialog,
  StatementDatesDialog,
  VerifyStatementDialog,
} from "@/components/card-dialogs";
import { CardTaxes } from "@/components/card-taxes-panel";
import { CardChargesInbox } from "@/components/card-charges-inbox";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useBankCharges, useCardCharges, useCardStatements } from "@/lib/firebase/hooks";
import type { CardCharge, CardFeeSettings } from "@/lib/firebase/converters";
import {
  addCardCharge,
  deleteCardCharge,
  moveCardChargesToStatement,
  openCardStatement,
  setCardChargeVerified,
  updateCardCharge,
  updateHouseholdCardFees,
  type CardChargeInput,
} from "@/lib/firebase/mutations";
import { formatUsd } from "@/lib/money";
import { formatLongDate, formatShortDate } from "@/lib/dates";
import {
  CARD_BRANDS,
  digitalUsdCents,
  isPastClosing,
  nextStatementProposal,
  statementTotalUsdCents,
  totalsByCard,
  type StatementRange,
} from "@/lib/statements";

/**
 * Today, pulled inside a statement's window. A charge belongs to whichever
 * statement contains its date, so a date outside the one on screen would file
 * the charge somewhere else — it would be saved, and then not be there.
 */
function clampToStatement(today: string, statement: StatementRange | null): string {
  if (statement === null) return today;
  if (today < statement.startDate) return statement.startDate;
  if (today > statement.closingDate) return statement.closingDate;
  return today;
}

/** A first statement has no predecessor to chain from, so today seeds it. */
function firstProposal(today: string): StatementRange {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const endOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const closing = `${today.slice(0, 7)}-${String(endOfMonth).padStart(2, "0")}`;
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  return {
    startDate: `${today.slice(0, 7)}-01`,
    closingDate: closing,
    dueDate: `${dueYear}-${String(dueMonth).padStart(2, "0")}-10`,
  };
}

/**
 * Which statement this device has already offered to reconcile.
 *
 * The same shape as the start-period screen's key, for the same reason: having
 * been shown a dialog is a fact about a browser, not about the household, so
 * it does not belong on the household document.
 */
function verifyOfferKey(householdId: string): string {
  return `gd:cardVerifyOffer:${householdId}`;
}

export default function CardsPage() {
  const t = useTranslations("cards");
  const tCommon = useTranslations("expenses");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { household, today } = useHousehold();
  const { statements, loading: statementsLoading } = useCardStatements(
    household?.id ?? null,
  );
  // The bank's own charges, so the credit ones can be recorded without retyping
  // what the email already said.
  const { charges: bankCharges } = useBankCharges(household?.id ?? null);

  /** Index into `statements` (newest first). 0 is the open one. */
  const [index, setIndex] = useState(0);
  const [chargeDialog, setChargeDialog] = useState<CardCharge | "new" | null>(null);
  const [datesDialog, setDatesDialog] = useState(false);
  const [feesDialog, setFeesDialog] = useState(false);
  /**
   * The reconcile dialog, and whether this device has already offered it for
   * this statement.
   *
   * Per device on purpose, like the start-period screen's key: "have I been
   * shown this" is a fact about a browser, not about the household. Undefined
   * means localStorage has not been read yet — opening the dialog before that
   * would flash it at somebody who dismissed it yesterday.
   */
  const [verifyDialog, setVerifyDialog] = useState(false);
  const [offeredFor, setOfferedFor] = useState<string | null | undefined>(
    undefined,
  );

  const shown = statements[Math.min(index, Math.max(statements.length - 1, 0))] ?? null;
  const isCurrent = index === 0;

  const { charges, loading: chargesLoading } = useCardCharges(
    household?.id ?? null,
    shown?.startDate ?? null,
    shown?.closingDate ?? null,
  );

  const total = useMemo(() => statementTotalUsdCents(charges), [charges]);
  const perCard = useMemo(() => totalsByCard(charges), [charges]);
  // The two peso taxes that fall on digital services need their own subtotal:
  // RG 5617 taxes everything, IIBB and RG 4240 only this part. Memoised as one
  // object so the panel's own memo has something stable to compare.
  /** Charges nobody ticked off against the paper statement. */
  const unverified = useMemo(
    () => charges.filter((charge) => !charge.verified),
    [charges],
  );

  const spend = useMemo(
    () => ({ usdCents: total, digitalUsdCents: digitalUsdCents(charges) }),
    [total, charges],
  );

  // Only ever true on the OPEN statement: a past one is meant to be past, and
  // saying so about it would be noise on every screen but the current one.
  const pastClosing = isCurrent && isPastClosing(today ?? "", shown);
  // The same question asked of the OPEN statement rather than the one on
  // screen, because the bank inbox files into the open one wherever the pager
  // has been walked back to.
  const openStatementClosed = isPastClosing(today ?? "", statements[0] ?? null);

  const householdId = household?.id ?? null;
  // Read once, after mount: localStorage does not exist while the shell is
  // prerendered.
  useEffect(() => {
    if (householdId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOfferedFor(localStorage.getItem(verifyOfferKey(householdId)));
  }, [householdId]);

  /**
   * Offer the reconcile dialog once, when the statement has closed and there
   * is still something to tick off.
   *
   * Fenced three ways. Only the OPEN statement past its closing date, so
   * walking the pager back to March does not ask about March. Only when
   * something is actually unverified, because a statement already checked off
   * has nothing to open. And only once per statement per device — the bank's
   * paper arrives once, and being asked again every visit is how a useful
   * prompt becomes one people learn to dismiss.
   */
  const closedAwaitingCheck = pastClosing && unverified.length > 0;
  const closingDate = shown?.closingDate ?? null;
  useEffect(() => {
    if (
      householdId === null ||
      // undefined = localStorage not read yet. Opening now would flash the
      // dialog at somebody who dismissed it yesterday.
      offeredFor === undefined ||
      !closedAwaitingCheck ||
      closingDate === null ||
      offeredFor === closingDate
    ) {
      return;
    }
    localStorage.setItem(verifyOfferKey(householdId), closingDate);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOfferedFor(closingDate);
    setVerifyDialog(true);
  }, [householdId, offeredFor, closedAwaitingCheck, closingDate]);

  if (household === null || today === null) return null;

  const withDb = (fn: (db: NonNullable<ReturnType<typeof getFirebaseClient>>["db"]) => Promise<void>) => {
    const fb = getFirebaseClient();
    // Never awaited: Firestore resolves a write only on server ack, and the
    // dialog must close the moment the row is queued locally.
    if (fb !== null) void fn(fb.db);
  };

  const saveCharge = (input: CardChargeInput) => {
    if (user === null) return;
    if (chargeDialog === "new") {
      withDb((db) => addCardCharge(db, household.id, user.uid, input));
    } else if (chargeDialog !== null) {
      withDb((db) => updateCardCharge(db, household.id, chargeDialog.id, input));
    }
    setChargeDialog(null);
  };

  const proposal =
    shown !== null ? nextStatementProposal(shown) : firstProposal(today);

  /* ── Empty: no statement has ever been opened ────────────────────────── */
  if (!statementsLoading && statements.length === 0) {
    return (
      <div className="mx-auto flex w-[660px] max-w-full flex-col gap-3.5">
        <h1 className="mb-1 text-[22px] font-bold text-ink">{t("title")}</h1>
        <CardChargesInbox
          household={household}
          charges={bankCharges}
          uid={user?.uid ?? null}
          locale={locale}
          // No statement has ever been opened: there is nowhere to file these.
          statementClosed
        />
        <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-line bg-surface px-6 py-10 text-center">
          <Icon name="credit_card" size={30} className="text-ink-3" />
          <span className="text-[15px] font-semibold text-ink">
            {t("emptyTitle")}
          </span>
          <span className="max-w-[320px] text-[12.5px] text-ink-3">
            {t("emptyBody")}
          </span>
          <button
            type="button"
            onClick={() => setDatesDialog(true)}
            className="mt-1 rounded-full bg-accent px-4 py-2.5 text-[13px] font-bold text-white"
          >
            {t("openFirstStatement")}
          </button>
        </div>
        {datesDialog && (
          <StatementDatesDialog
            proposal={proposal}
            closing={null}
            unverifiedCount={0}
            locale={locale}
            onSave={(range) => {
              withDb((db) => openCardStatement(db, household.id, range));
              setIndex(0);
              setDatesDialog(false);
            }}
            onClose={() => setDatesDialog(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-[660px] max-w-full flex-col gap-3.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setChargeDialog("new")}
          className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2"
        >
          <Icon name="add" size={16} className="text-white" />
          <span className="text-[13px] font-bold text-white">
            {t("addCharge")}
          </span>
        </button>
      </div>

      <CardChargesInbox
        household={household}
        charges={bankCharges}
        uid={user?.uid ?? null}
        locale={locale}
        // Blocked once the open statement's closing date has gone by, whichever
        // statement the pager happens to be showing: the inbox always files
        // into the open one, not the one being looked at.
        statementClosed={openStatementClosed}
      />

      {shown !== null && (
        <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4">
          {/* Which statement, and how to walk back through the earlier ones. */}
          <div className="flex items-center justify-between gap-2">
            <span className="section-label">
              {isCurrent ? t("currentStatement") : t("pastStatement")}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t("older")}
                disabled={index >= statements.length - 1}
                onClick={() => setIndex((i) => i + 1)}
                className="rounded-full p-1 disabled:opacity-30"
              >
                <Icon name="chevron_left" size={18} className="text-ink-2" />
              </button>
              <button
                type="button"
                aria-label={t("newer")}
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="rounded-full p-1 disabled:opacity-30"
              >
                <Icon name="chevron_right" size={18} className="text-ink-2" />
              </button>
            </div>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="tnum text-[30px] font-bold leading-none tracking-[-0.02em] text-ink">
                {formatUsd(total, locale)}
              </span>
              <span className="text-[11.5px] text-ink-3">
                {t("chargeCount", { count: charges.length })}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              {CARD_BRANDS.filter((brand) => perCard[brand] !== undefined).map(
                (brand) => (
                  <span key={brand} className="flex items-center gap-2">
                    <CardMark brand={brand} size={26} />
                    <span className="tnum text-[13px] font-semibold text-ink-2">
                      {formatUsd(perCard[brand] ?? 0, locale)}
                    </span>
                  </span>
                ),
              )}
              {/* The peso taxes belong with the statement's other figures: they
                  are part of what this month costs. The five lines behind the
                  "i" — they are read once a month, if that. */}
              <CardTaxes
                spend={spend}
                fees={household.cardFees}
                locale={locale}
                onEditFees={() => setFeesDialog(true)}
              />
            </div>
          </div>

          {/* The two dates, side by side, each labelled with what it means. */}
          <div className="grid grid-cols-2 gap-3 border-t border-soft pt-3">
            <div className="flex flex-col gap-0.5">
              <span className="section-label">{t("closingDate")}</span>
              <span className="text-[13.5px] font-bold text-ink">
                {formatLongDate(shown.closingDate, locale)}
              </span>
              <span className="text-[11px] text-ink-3">
                {t("fromDate", {
                  date: formatShortDate(shown.startDate, locale),
                })}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="section-label">{t("dueDate")}</span>
              <span className="text-[13.5px] font-bold text-ink">
                {formatLongDate(shown.dueDate, locale)}
              </span>
            </div>
          </div>

          {pastClosing && shown !== null && (
            // The charges themselves are filed by date, so a purchase made
            // after the closing day cannot go on this statement without being
            // back-dated. Says so where the dates are, and offers the fix.
            <div
              className="flex flex-col gap-2 rounded-[12px] bg-warn-bg px-3 py-2.5"
              role="alert"
            >
              <span
                className="text-[12.5px] font-bold"
                style={{ color: "var(--warn-text)" }}
              >
                {t("pastClosingTitle")}
              </span>
              <span
                className="text-[11.5px] leading-snug"
                style={{ color: "var(--warn-text)" }}
              >
                {t("pastClosingBody", {
                  date: formatLongDate(shown.closingDate, locale),
                  today: formatLongDate(today, locale),
                })}
              </span>
              {/* The way back in. The dialog offers itself once when the
                  statement closes; after that this is how you finish a job you
                  put down, and it says how much is left rather than making you
                  open it to find out. */}
              {unverified.length > 0 && (
                <button
                  type="button"
                  onClick={() => setVerifyDialog(true)}
                  className="mt-0.5 self-start rounded-full bg-surface px-3 py-1.5 text-[12px] font-bold"
                  style={{ color: "var(--warn-text)" }}
                >
                  {t("verifyOpen")} ·{" "}
                  {t("verifyPending", { count: unverified.length })}
                </button>
              )}
            </div>
          )}

          {isCurrent && (
            // Secondary, and small. Closing a statement happens once a month; a
            // full-width primary button gave a rare, hard-to-undo action the
            // most prominent spot on the card.
            //
            // Deleting one used to live here and no longer does. A statement is
            // a window other rows are filed into, so removing it made a month's
            // charges disappear from every screen at once — and the only reason
            // to reach for it, a wrong closing date, is what the dialog fixes.
            <div className="flex flex-wrap items-center gap-2.5 border-t border-soft pt-3">
              <button
                type="button"
                onClick={() => setDatesDialog(true)}
                className="rounded-full border border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink-2"
              >
                {t("closeAndOpen")}
              </button>
            </div>
          )}
        </div>
      )}

      {chargesLoading && charges.length === 0 && (
        <p className="px-1 text-[13px] text-ink-3">{t("loading")}</p>
      )}

      {!chargesLoading && charges.length === 0 && (
        <p className="rounded-[18px] border border-line bg-surface px-[18px] py-8 text-center text-[13px] text-ink-3">
          {t("noCharges")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {charges.map((charge) => (
          // A row, not a button: the verify tick has to be its own control, and
          // a button inside a button is invalid HTML that browsers resolve by
          // dropping one of them.
          <div
            key={charge.id}
            className="flex items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3"
          >
            <button
              type="button"
              onClick={() => setChargeDialog(charge)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex w-[52px] flex-none justify-center">
                <CardMark brand={charge.card} size={30} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-semibold text-ink">
                  {charge.detail !== "" ? charge.detail : CARD_LABELS[charge.card]}
                </span>
                <span className="text-[11.5px] text-ink-3">
                  {formatShortDate(charge.date, locale)}
                  {charge.pendingWrite && ` · ${tCommon("pending")}`}
                  {/* Only worth saying when it is NOT the default: nearly every
                      charge is digital, so labelling those would be noise. */}
                  {!charge.digital && ` · ${t("notDigital")}`}
                </span>
              </div>
              <span className="tnum flex-none text-[15px] font-bold text-ink">
                {formatUsd(charge.usdCents, locale)}
              </span>
            </button>
          </div>
        ))}
      </div>

      {verifyDialog && shown !== null && (
        <VerifyStatementDialog
          charges={charges}
          closingDate={shown.closingDate}
          locale={locale}
          onToggle={(charge, verified) =>
            withDb((db) =>
              setCardChargeVerified(db, household.id, charge.id, verified),
            )
          }
          onClose={() => setVerifyDialog(false)}
        />
      )}

      {chargeDialog !== null && (
        <CardChargeDialog
          charge={chargeDialog === "new" ? null : chargeDialog}
          // A new charge defaults to today — but CLAMPED into the statement
          // being looked at. Charges are filed by date, so leaving today's date
          // on a charge added to a past or future statement would save it into
          // a different window and make it vanish from the screen that just
          // accepted it.
          defaultDate={clampToStatement(today, shown)}
          // Only when ADDING: editing an old charge on a closed statement is
          // exactly what the screen is for, and warning there would fire on
          // every correction anyone ever makes to a past month.
          pastClosing={
            pastClosing && chargeDialog === "new" && shown !== null
              ? { closingDate: shown.closingDate, today }
              : null
          }
          locale={locale}
          onSave={saveCharge}
          onDelete={
            chargeDialog === "new"
              ? null
              : () => {
                  withDb((db) =>
                    deleteCardCharge(db, household.id, chargeDialog.id),
                  );
                  setChargeDialog(null);
                }
          }
          onClose={() => setChargeDialog(null)}
        />
      )}

      {feesDialog && (
        <CardFeesDialog
          fees={household.cardFees}
          locale={locale}
          onSave={(fees: CardFeeSettings) => {
            withDb((db) => updateHouseholdCardFees(db, household.id, fees));
            setFeesDialog(false);
          }}
          onClose={() => setFeesDialog(false)}
        />
      )}

      {datesDialog && (
        <StatementDatesDialog
          proposal={proposal}
          closing={shown}
          unverifiedCount={unverified.length}
          locale={locale}
          onSave={(range, moveUnverified) => {
            withDb((db) => openCardStatement(db, household.id, range));
            // Not chained behind the statement write. A charge is filed by its
            // own date, so it lands in the new window whether or not the
            // statement doc has reached the server yet — and awaiting a
            // Firestore write would freeze this offline, where both are
            // already applied locally.
            if (moveUnverified) {
              withDb((db) =>
                moveCardChargesToStatement(
                  db,
                  household.id,
                  unverified.map((charge) => charge.id),
                  range.startDate,
                ),
              );
            }
            setIndex(0);
            setDatesDialog(false);
          }}
          onClose={() => setDatesDialog(false)}
        />
      )}
    </div>
  );
}
