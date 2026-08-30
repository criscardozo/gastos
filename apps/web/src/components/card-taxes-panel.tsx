"use client";

// The peso side of a card statement, on the Tarjetas screen.
//
// The statement itself is USD — that is what the card bills — but the bank
// charges the taxes in ARS, and the point of this panel is knowing how many
// pesos the month is about to cost before the bill arrives. An ESTIMATE,
// labelled as one: the arithmetic is in `lib/card-taxes.ts` and the rate comes
// from a public quote service, so neither is a promise.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { CurrencyTag } from "@/components/ui/marks";
import type { CardFeeSettings } from "@/lib/firebase/converters";
import {
  taxLines,
  totalArsCents,
  usdToArsCents,
  type StatementSpend,
} from "@/lib/card-taxes";
import { formatShortDate } from "@/lib/dates";
import { formatArs, formatUsd } from "@/lib/money";
import { fetchTodayRate, resolveRate, type RateSource } from "@/lib/usd-rate";

/**
 * Today's official rate, fetched once per mount.
 *
 * Not a Firestore listener and not on an interval: the quote moves once a day
 * and this is a screen somebody opens, looks at, and leaves.
 */
function useUsdArsRate(fallback: number | null): RateSource | null {
  const [fromApi, setFromApi] = useState<{ rate: number; asOf: string } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    void fetchTodayRate().then((quote) => {
      // The screen may be gone by the time the network answers.
      if (live) setFromApi(quote);
    });
    return () => {
      live = false;
    };
  }, []);

  return resolveRate(fromApi, fallback);
}

export function CardTaxesPanel({
  spend,
  fees,
  locale,
  onEdit,
}: {
  /** The statement's foreign spend, and the digital part of it. */
  spend: StatementSpend;
  fees: CardFeeSettings;
  locale: string;
  onEdit: () => void;
}) {
  const t = useTranslations("cards");
  const rate = useUsdArsRate(fees.usdArsRate);

  const lines = useMemo(
    () =>
      rate === null
        ? []
        : taxLines(spend, rate.rate, {
            commissionArsCents: fees.commissionArsCents,
          }),
    [spend, rate, fees.commissionArsCents],
  );

  const rateMessage =
    rate === null || rate.origin === "manual"
      ? "arsRateManual"
      : rate.asOf !== undefined && rate.asOf !== ""
        ? "arsRateApiDated"
        : "arsRateApi";

  // Nothing configured and nothing spent: no panel at all rather than a card
  // full of zeroes — or a prompt for a rate — on a household that does not have
  // an Argentine card. Checked on the inputs, not on `lines`, so the panel also
  // stays away while the rate is still unknown.
  if (spend.usdCents === 0 && fees.commissionArsCents === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="section-label">
          {/* The flag carries the currency: every other figure on this screen
              is USD, and two amounts side by side need telling apart at a
              glance rather than by reading the symbol. */}
          <span aria-hidden="true">🇦🇷</span> {t("arsTitle")}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("arsSettings")}
          className="rounded-full border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-2"
        >
          <Icon name="settings" size={14} className="text-ink-2" />
        </button>
      </div>

      {rate === null ? (
        <p className="text-[12.5px] text-ink-3">{t("arsNoRate")}</p>
      ) : (
        <>
          {/* What the month's purchases are worth in pesos. Above the line and
              NOT added into the total below it, because the bank bills them in
              dollars — the peso balance it charges is the taxes alone. Shown
              because "how many pesos is this month" is the actual question. */}
          {spend.usdCents > 0 && (
            <div className="flex items-baseline justify-between gap-3 border-b border-soft pb-3">
              <span className="flex flex-col">
                <span className="text-[12.5px] font-semibold text-ink-2">
                  {t("arsSpend")}
                </span>
                <span className="text-[11px] text-ink-3">
                  {formatUsd(spend.usdCents, locale)}
                </span>
              </span>
              <span className="flex flex-none items-baseline gap-1.5">
                <span className="tnum text-[15px] font-bold text-ink-2">
                  {formatArs(usdToArsCents(spend.usdCents, rate.rate))}
                </span>
                <CurrencyTag currency="ARS" />
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-ink-2">
                    {line.label}
                  </span>
                  <span className="text-[11px] text-ink-3">{line.basis}</span>
                </span>
                <span className="tnum flex-none text-[13.5px] font-semibold text-ink">
                  {formatArs(line.arsCents)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-baseline justify-between gap-3 border-t border-soft pt-3">
            <span className="flex flex-col">
              <span className="text-[12.5px] font-semibold text-ink-2">
                {t("arsTotal")}
              </span>
              <span className="text-[11px] text-ink-3">
                {/* Which day the quote is from, when the service said so: a
                    rate is only as good as its date, and the official one is
                    published once a day. */}
                {t(rateMessage, {
                  rate: rate.rate.toLocaleString("es-AR", {
                    maximumFractionDigits: 2,
                  }),
                  date:
                    rate.asOf !== undefined && rate.asOf !== ""
                      ? formatShortDate(rate.asOf, locale)
                      : "",
                })}
              </span>
            </span>
            {/* Marked, like every other total in the app: this is the one
                figure on any screen that is neither AUD nor USD. */}
            <span className="flex flex-none items-baseline gap-1.5">
              <span className="tnum text-[19px] font-bold text-ink">
                {formatArs(totalArsCents(lines))}
              </span>
              <CurrencyTag currency="ARS" />
            </span>
          </div>

          {/* Says which lines depend on a flag the user sets, because two of
              the five are only as right as that flag is. */}
          <p className="text-[11px] leading-snug text-ink-3">
            {t("arsCaveat")}
          </p>
        </>
      )}
    </div>
  );
}
