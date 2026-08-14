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

import { Icon } from "@/components/ui/icon";
import { CardMark } from "@/components/ui/marks";
import { DismissedCharges } from "@/components/dismissed-charges";
import { getFirebaseClient } from "@/lib/firebase/client";
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

export function CardChargesInbox({
  household,
  charges,
  uid,
  locale,
}: {
  household: Household;
  charges: BankChargeDoc[];
  uid: string | null;
  locale: string;
}) {
  const t = useTranslations("cardsInbox");

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

  const withDb = (fn: (db: NonNullable<ReturnType<typeof getFirebaseClient>>["db"]) => Promise<void>) => {
    const fb = getFirebaseClient();
    // Never awaited: Firestore only resolves on server ack.
    if (fb !== null) void fn(fb.db);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-col gap-1">
        <span className="section-label">{t("title")}</span>
        <p className="text-[11.5px] leading-snug text-ink-3">
          {pending.length > 0 ? t("hint", { count: pending.length }) : t("allClear")}
        </p>
      </div>

      <div className="divide-y divide-soft">
        {pending.map((charge) => {
          const configured = brandFor(charge.cardLast4, household.cards);
          const brand = brands[charge.id] ?? configured;
          const unidentified =
            classifyCharge(charge.cardLast4, household.cards) === "unknown";
          return (
            <div key={charge.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="tnum text-[16px] font-bold text-ink">
                  {formatUsd(charge.usdCents, locale)}
                </span>
                <span className="truncate text-[11.5px] text-ink-3">
                  {formatShortDate(charge.date, locale)}
                  {charge.merchant !== "" && ` · ${charge.merchant}`}
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
                    charge.merchant !== "" ? ` · ${charge.merchant}` : ""
                  }`}
                  disabled={brand === null || uid === null}
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
                        },
                      ),
                    );
                  }}
                  className="ml-auto rounded-full bg-accent px-3.5 py-[7px] disabled:opacity-40"
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

              {unidentified && (
                <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  <Icon name="info" size={13} className="text-ink-3" />
                  {t("unidentified")}
                </span>
              )}
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
