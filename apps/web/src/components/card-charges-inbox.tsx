"use client";

// The bank's charges that belong to a credit card, waiting to be recorded.
//
// The ingestion files every charge the bank emails about; which card it came
// from is only knowable from the four digits the email prints. Once the
// household says which digits are the credit card (Ajustes → Tarjetas), those
// charges stop cluttering expense verification and land here instead — already
// carrying their date, merchant and USD figure, so recording one is a single
// press rather than retyping what the bank already told us.
//
// A charge whose card is unidentified appears here AND in expense verification,
// on purpose: showing it twice costs a moment, hiding it costs the charge.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { CardMark } from "@/components/ui/marks";
import { DismissedCharges } from "@/components/dismissed-charges";
import { useDbWrite } from "@/components/use-db-write";
import {
  dismissBankCharge,
  importBankChargeAsCardCharge,
  restoreBankCharge,
} from "@/lib/firebase/mutations";
import type { BankChargeDoc, Household } from "@/lib/firebase/converters";
import { partitionCharges } from "@/lib/bank-charges";
import { belongsToCard, brandFor, classifyCharge } from "@/lib/cards";
import { formatUsd } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import { CARD_BRANDS, type CardBrand } from "@/lib/statements";
import { displayMerchant } from "@/lib/merchant-name";

export function CardChargesInbox({
  household,
  charges,
  uid,
  locale,
  openClosingDate,
}: {
  household: Household;
  charges: BankChargeDoc[];
  uid: string | null;
  locale: string;
  /**
   * The open statement's closing date, or null when none has ever been opened.
   *
   * A charge keeps its own date, so it lands in whichever statement contains
   * it: one dated on or before the closing date still belongs to the open
   * statement even once that date has gone by — the bank often emails a
   * purchase days later. Only a charge dated AFTER the closing date has nowhere
   * honest to go until the next statement is opened, so it alone is blocked,
   * rather than the whole inbox.
   */
  openClosingDate: string | null;
}) {
  const t = useTranslations("cardsInbox");
  const withDb = useDbWrite();
  const tCards = useTranslations("cards");

  /** Brand chosen per charge, when the configured one is not enough. */
  const [brands, setBrands] = useState<Record<string, CardBrand>>({});

  const mine = useMemo(
    () => charges.filter((c) => belongsToCard(c.cardLast4, household.cards)),
    [charges, household.cards],
  );
  // The hook already dropped anything past the 48h window, so `dismissed` is
  // exactly what can still be taken back.
  const { pending, dismissed } = useMemo(
    () => partitionCharges(mine, new Date()),
    [mine],
  );

  if (pending.length === 0 && dismissed.length === 0) return null;

  const isBlocked = (charge: BankChargeDoc) =>
    openClosingDate === null || charge.date > openClosingDate;
  const blockedCount = pending.filter(isBlocked).length;

  const unidentifiedCount = pending.filter(
    (c) => classifyCharge(c.cardLast4, household.cards) === "unknown",
  ).length;


  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-col gap-1">
        <span className="section-label">{t("title")}</span>
        <p className="text-[11.5px] leading-snug text-ink-3">
          {pending.length > 0 ? t("hint", { count: pending.length }) : t("allClear")}
        </p>
        {/* Said once, with a count, rather than under every row: with no card
            configured yet that is every charge, and the same sentence five
            times in a list of five is noise the eye learns to skip. */}
        {unidentifiedCount > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-ink-3">
            <Icon name="info" size={13} className="flex-none text-ink-3" />
            <span>{t("unidentified", { count: unidentifiedCount })}</span>
            {/* The fix is on another screen, so the note carries the way
                there: it used to say "configure them in Ajustes" and leave
                finding where. */}
            <Link
              href="/ajustes#tarjetas"
              className="font-bold text-accent-strong underline-offset-2 hover:underline"
            >
              {t("configureCards")}
            </Link>
          </p>
        )}
      </div>

      {/* Says WHY the buttons are dead, where the buttons are. A row of
          disabled controls with no explanation reads as a broken screen. */}
      {blockedCount > 0 && (
        <div
          className="flex flex-col gap-px rounded-[12px] bg-warn-bg px-3 py-2.5"
          role="alert"
        >
          <span
            className="text-[12.5px] font-bold"
            style={{ color: "var(--warn-text)" }}
          >
            {tCards("inboxClosedTitle")}
          </span>
          <span
            className="text-[11.5px] leading-snug"
            style={{ color: "var(--warn-text)" }}
          >
            {openClosingDate === null
              ? tCards("inboxNoStatementBody")
              : tCards("inboxClosedBody", {
                  count: blockedCount,
                  date: formatShortDate(openClosingDate, locale),
                })}
          </span>
        </div>
      )}

      <div className="divide-y divide-soft">
        {pending.map((charge) => {
          const configured = brandFor(charge.cardLast4, household.cards);
          const brand = brands[charge.id] ?? configured;
          return (
            <div key={charge.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="tnum text-[16px] font-bold text-ink">
                  {formatUsd(charge.usdCents, locale)}
                </span>
                <span className="truncate text-[11.5px] text-ink-3">
                  {formatShortDate(charge.date, locale)}
                  {charge.merchant !== "" && ` · ${displayMerchant(charge.merchant)}`}
                  {charge.cardLast4 !== null && ` · ••${charge.cardLast4}`}
                </span>
              </div>

              {/* The card it goes on. Prefilled from the configuration; asked
                  for only when the digits were never identified. */}
              <div className="flex flex-wrap items-center gap-2">
                {CARD_BRANDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={brand === value}
                    aria-label={value}
                    onClick={() =>
                      setBrands((prev) => ({ ...prev, [charge.id]: value }))
                    }
                    className={`flex items-center justify-center rounded-xl border px-3 py-1.5 ${
                      brand === value
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-bg"
                    }`}
                  >
                    <CardMark brand={value} size={26} />
                  </button>
                ))}

                <button
                  type="button"
                  // Named after the charge: a screen reader hearing "Agregar"
                  // three times learns nothing about which one it is on.
                  aria-label={`${t("add")} ${formatUsd(charge.usdCents, locale)}${
                    charge.merchant !== "" ? ` · ${displayMerchant(charge.merchant)}` : ""
                  }`}
                  disabled={brand === null || uid === null || isBlocked(charge)}
                  onClick={() => {
                    if (brand === null || uid === null) return;
                    withDb((db) =>
                      importBankChargeAsCardCharge(
                        db,
                        household.id,
                        uid,
                        charge.id,
                        {
                          date: charge.date,
                          detail: charge.merchant,
                          card: brand,
                          usdCents: charge.usdCents,
                          // The bank's email does not say whether the merchant
                          // is a digital service, so this takes the default —
                          // not digital, which is what nearly every charge is —
                          // and the charge can be corrected on Tarjetas.
                          digital: false,
                        },
                      ),
                    );
                  }}
                  className="ml-auto rounded-full bg-accent px-3.5 py-[7px] primary-disabled"
                >
                  <span className="text-[12.5px] font-bold text-white">
                    {t("add")}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${t("dismiss")} ${formatUsd(charge.usdCents, locale)}`}
                  // Recoverable for 48h from the list below, so no confirm.
                  onClick={() =>
                    withDb((db) => dismissBankCharge(db, household.id, charge.id))
                  }
                  className="px-1.5 py-[7px]"
                >
                  <span className="text-[12.5px] font-semibold text-ink-2">
                    {t("dismiss")}
                  </span>
                </button>
              </div>

            </div>
          );
        })}
      </div>

      <DismissedCharges
        charges={dismissed}
        onRestore={(chargeId) =>
          withDb((db) => restoreBankCharge(db, household.id, chargeId))
        }
        locale={locale}
      />
    </div>
  );
}
