"use client";

// The bank's pending USD charges, waiting to be matched to an expense.
//
// The Gmail ingestion (tools/gmail-bank-ingest) drops a charge per notification
// email into `households/{id}/bankCharges`; this panel proposes which expense
// each one belongs to and the user confirms. Matching itself lives in
// lib/bank-match.ts — this file only renders it and writes the confirmed pair.
//
// Suggestions are matched against the expenses of the period the page is
// showing, which is where a charge that arrived in the last day or two lands.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { CreateFromChargeDialog } from "@/components/create-from-charge-dialog";
import { useServices } from "@/lib/firebase/hooks";
import { useAppError } from "@/components/app-error";
import { useAuth } from "@/components/providers";
import { DismissedCharges } from "@/components/dismissed-charges";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  assignBankCharge,
  dismissBankCharge,
  chargeIdFromAutoExpense,
  fileChargeAsExpense,
  requestBankIngest,
  restoreBankCharge,
} from "@/lib/firebase/mutations";
import type { BankChargeDoc, Expense, Household } from "@/lib/firebase/converters";
import {
  learnRate,
  suggestMatches,
  type BankCharge as MatchableCharge,
} from "@/lib/bank-match";
import { partitionCharges, wasFiledAsExpense } from "@/lib/bank-charges";
import { belongsToExpenses } from "@/lib/cards";
import { formatCents, formatUsd } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";

/** "0,652" / "0.652" — the bank's rate, as many decimals as it deserves. */
function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale === "es" ? "es-AR" : "en-AU", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rate);
}

/**
 * The Apps Script web app that runs the Gmail ingestion, from
 * NEXT_PUBLIC_INGEST_URL. Absent — a local dev run, or before the script is
 * deployed — the button is not rendered at all rather than shown broken.
 */
const INGEST_ENDPOINT = process.env.NEXT_PUBLIC_INGEST_URL ?? null;

export function BankChargesPanel({
  household,
  charges,
  expenses,
  expenseLabel,
  onMakeRecurring,
  locale,
}: {
  household: Household;
  charges: BankChargeDoc[];
  /** Expenses of the period on screen — the pool a charge can match. */
  expenses: Expense[];
  /** Note, or the category name when the note is empty. */
  expenseLabel: (expense: Expense) => string;
  /**
   * Turn this charge into a recurring rule, pre-filled.
   *
   * Takes the two things a rule needs suggested — how the bank spells the
   * merchant, and what it charged — rather than the document, because the
   * point is that both are already on screen and retyping what you are
   * looking at is the thing this removes.
   */
  onMakeRecurring: (seed: { merchant: string; usdCents: number }) => void;
  locale: string;
}) {
  const t = useTranslations("bank");
  const tRecurring = useTranslations("recurring");
  const { write } = useAppError();
  const { user } = useAuth();
  // Open when there is something waiting, closed when there is not — and once
  // you have collapsed or expanded it by hand, that wins.
  //
  // Not `useState(pending.length > 0)`: an initialiser runs once, and the
  // charges arrive from a listener a moment later, so the panel would have
  // decided it was empty before the data came. Null means "nobody has said".
  const [openedByHand, setOpenedByHand] = useState<boolean | null>(null);
  /** The charge whose "Crear gasto" dialog is up. */
  const [creatingFrom, setCreatingFrom] = useState<string | null>(null);

  // Only while "Crear gasto" is open. Same reason as the recurring dialog: an
  // expense filed in Servicios links to a service by name, so the note has to
  // be chosen rather than typed — and this dialog seeds it with the merchant.
  const servicesForNote = useServices(
    creatingFrom === null ? null : household.id,
  ).services;
  /** Manual overrides, charge id → expense id ("" = none chosen). */
  const [choice, setChoice] = useState<Record<string, string>>({});

  const rate = useMemo(() => learnRate(expenses), [expenses]);
  // Only what could be an EXPENSE: the debit card's charges, plus anything the
  // household has not identified — a charge nobody claims must never vanish, so
  // it shows here AND on Tarjetas rather than in neither.
  const mine = useMemo(
    () => charges.filter((c) => belongsToExpenses(c.cardLast4, household.cards)),
    [charges, household.cards],
  );
  // The hook already dropped anything past the window, so `dismissed` here is
  // exactly what is still recoverable. `expired` is empty by construction.
  const { pending, dismissed: stamped } = useMemo(
    () => partitionCharges(mine, new Date()),
    [mine],
  );

  // A charge that BECAME an expense carries the same `dismissedAt` as one
  // somebody threw away, so it was listed among the discarded with the same
  // "Restaurar" — which only clears the stamp. Pressing it returned the charge
  // to pending and left the expense: the same purchase counted twice, with
  // nothing on screen saying so.
  //
  // They are told apart by the expense's id, which filing derives from the
  // charge, so nothing had to be stored to fix this. The way back for a filed
  // charge is the undo on the expense row, which deletes both.
  const filedChargeIds = useMemo(
    () =>
      new Set(
        expenses
          .map((e) => chargeIdFromAutoExpense(e.id))
          .filter((id): id is string => id !== null),
      ),
    [expenses],
  );
  const dismissed = useMemo(
    () => stamped.filter((c) => !wasFiledAsExpense(c.id, filedChargeIds)),
    [stamped, filedChargeIds],
  );
  // Derived, so a charge arriving after the first render opens the panel.
  const open = openedByHand ?? pending.length > 0;

  const suggestions = useMemo(
    () => suggestMatches(pending, expenses, rate),
    [pending, expenses, rate],
  );
  const unverified = useMemo(
    () => expenses.filter((e) => !e.verified),
    [expenses],
  );

  // Ask the ingestion to run now. Firestore is written first and the endpoint
  // pinged second — see requestBankIngest for why that order IS the security
  // model. `fetching` only gates the double click: what tells the user it
  // worked is a charge appearing, which the listener does on its own.
  const [fetching, setFetching] = useState(false);
  const fetchNow = () => {
    const fb = getFirebaseClient();
    if (fb === null || fetching) return;
    setFetching(true);
    write(
      requestBankIngest(fb.db, household.id, INGEST_ENDPOINT).finally(() => {
        // Long enough that the charge has a chance to arrive before the button
        // invites another go.
        setTimeout(() => setFetching(false), 4000);
      }),
    );
  };

  const fetchButton = INGEST_ENDPOINT === null ? null : (
    <button
      type="button"
      onClick={fetchNow}
      disabled={fetching}
      className="flex items-center gap-1.5 rounded-full border border-pill px-3 py-1 text-[12.5px] font-semibold text-ink-2 disabled:opacity-60"
    >
      <Icon name={fetching ? "hourglass_top" : "sync"} size={15} />
      {fetching ? t("fetching") : t("fetchNow")}
    </button>
  );

  // With nothing pending the panel is just the button: this is exactly when
  // somebody wants it, and returning null here used to hide the only way to
  // ask for a charge that has not arrived yet.
  if (pending.length === 0 && dismissed.length === 0) {
    if (fetchButton === null) return null;
    return <div className="flex justify-end">{fetchButton}</div>;
  }

  const chosenFor = (chargeId: string, suggested: string | null): string =>
    choice[chargeId] ?? suggested ?? "";

  // Not awaited: see the entry forms. The batch lands in the local cache
  // immediately — the charge leaves this list and the expense shows its USD —
  // and Firestore syncs it when there is a network again.
  //
  // Typed as the matcher's charge, not the stored doc: that is what the
  // suggestions carry, and the id + amount is all either of these needs.
  const assign = (charge: MatchableCharge, expenseId: string) => {
    const fb = getFirebaseClient();
    if (fb === null || expenseId === "") return;
    write(
      assignBankCharge(
        fb.db,
        household.id,
        charge.id,
        expenseId,
        charge.usdCents,
      ),
    );
  };

  // No confirm dialog any more: dismissing is recoverable for 48 hours from
  // the Descartados list below, which is a better answer to a misclick than a
  // prompt on every single charge.
  const discard = (charge: MatchableCharge) => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    write(dismissBankCharge(fb.db, household.id, charge.id));
  };

  const restore = (chargeId: string) => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    write(restoreBankCharge(fb.db, household.id, chargeId));
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-info-bg">
          <Icon name="error" size={17} style={{ color: "var(--info-text)" }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] font-bold text-ink">
            {/* With nothing pending the card is only here for the discarded
                list below, and "0 cargos sin asignar" would be a strange way
                to say so. */}
            {pending.length > 0
              ? t("pending", { count: pending.length })
              : t("allClear")}
          </span>
          {pending.length > 0 && (
            <span className="text-[11.5px] text-ink-3">
              {rate !== null
                ? t("hintWithRate", { rate: formatRate(rate, locale) })
                : t("hint")}
            </span>
          )}
        </div>
        {fetchButton}
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenedByHand(!open)}
            className="rounded-full border border-pill bg-surface px-3.5 py-1.5 text-[12.5px] font-bold text-ink"
          >
            {open ? t("hide") : t("review")}
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col divide-y divide-soft border-t border-soft">
          {suggestions.map(({ charge, expenseId, score, impliedRate }) => {
            const chosen = chosenFor(charge.id, expenseId);
            return (
              <div
                key={charge.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="tnum text-sm font-bold text-ink">
                    {formatUsd(charge.usdCents, locale)}
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {formatShortDate(charge.date, locale)}
                    {charge.merchant !== "" && ` · ${charge.merchant}`}
                    {charge.cardLast4 !== null && ` · ••${charge.cardLast4}`}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  <select
                    value={chosen}
                    aria-label={t("chooseExpense")}
                    onChange={(event) =>
                      setChoice({ ...choice, [charge.id]: event.target.value })
                    }
                    className="max-w-[260px] cursor-pointer truncate rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13px] font-semibold text-ink outline-none"
                  >
                    <option value="">{t("none")}</option>
                    {unverified.map((e) => (
                      <option key={e.id} value={e.id}>
                        {`${expenseLabel(e)} · ${formatCents(
                          e.amountCents,
                          household.currency,
                          locale,
                        )} · ${formatShortDate(e.date, locale)}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] font-semibold text-ink-3">
                    {/* The implied rate is the reason the suggestion exists,
                        so it is shown rather than a bare confidence bar. */}
                    {expenseId === null
                      ? t("noCandidate")
                      : t("suggested", {
                          rate: formatRate(impliedRate ?? 0, locale),
                          score: Math.round(score * 100),
                        })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => assign(charge, chosen)}
                    disabled={chosen === ""}
                    className="rounded-full bg-accent px-3.5 py-[7px] text-[12.5px] font-bold text-white disabled:opacity-40"
                  >
                    {t("assign")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onMakeRecurring({
                        merchant: charge.merchant,
                        usdCents: charge.usdCents,
                      })
                    }
                    title={tRecurring("fromCharge")}
                    /* Named after the charge, because there is one of these
                       per row: without it every button in the list reads
                       "Hacerlo recurrente" and only the row says which. */
                    aria-label={`${tRecurring("fromCharge")} — ${
                      charge.merchant !== ""
                        ? charge.merchant
                        : formatUsd(charge.usdCents, locale)
                    }`}
                    className="flex items-center text-ink-2"
                  >
                    <Icon name="autorenew" size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingFrom(charge.id)}
                    /* Named after its charge: there is one per row, and
                       "Crear gasto" alone says nothing about which. */
                    aria-label={`${t("createExpense")} — ${
                      charge.merchant !== ""
                        ? charge.merchant
                        : formatUsd(charge.usdCents, locale)
                    }`}
                    className="text-[12.5px] font-bold text-accent-strong"
                  >
                    {t("createExpense")}
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(charge)}
                    className="text-[12.5px] font-semibold text-ink-2 disabled:opacity-40"
                  >
                    {t("discard")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creatingFrom !== null &&
        (() => {
          const charge = pending.find((c) => c.id === creatingFrom);
          if (charge === undefined) return null;
          return (
            <CreateFromChargeDialog
              charge={charge}
              household={household}
              locale={locale}
              learnedRate={rate}
              services={servicesForNote}
              onCreate={(input) => {
                const fb = getFirebaseClient();
                if (fb === null || user === null) return;
                write(
                  fileChargeAsExpense(
                    fb.db,
                    household.id,
                    user.uid,
                    charge,
                    input,
                  ),
                );
                setCreatingFrom(null);
              }}
              onClose={() => setCreatingFrom(null)}
            />
          );
        })()}

      <DismissedCharges
        charges={dismissed}
        onRestore={restore}
        locale={locale}
      />
    </div>
  );
}
