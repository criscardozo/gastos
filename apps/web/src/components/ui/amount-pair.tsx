"use client";

// Bi-currency amount: shows the canonical AUD figure and its USD counterpart,
// stacked and right-aligned, with the ACTIVE currency emphasized and the other
// muted. AUD (from `amountCents`/sums) is always exact. USD is exact only when
// it is a USD-entered expense's original (`usdExactCents`); otherwise it is a
// display-only conversion of the AUD amount and is prefixed with ≈. With no FX
// rate and no exact USD, only the AUD figure renders (AUD-only fallback).

import { convertCents } from "@/lib/fx";
import { formatApproxUsd, formatCents, formatUsd } from "@/lib/money";
import type { ActiveCurrency } from "@/lib/use-currency";

export function AmountPair({
  audCents,
  usdExactCents,
  usdRate,
  active,
  locale,
  size = "sm",
}: {
  audCents: number;
  /** Exact original USD cents for a USD-entered expense; omit otherwise. */
  usdExactCents?: number;
  usdRate: number | null;
  active: ActiveCurrency;
  locale: string;
  /** Primary figure size. */
  size?: "sm" | "lg";
}) {
  const aud = formatCents(audCents, "AUD", locale);
  const usd =
    usdExactCents !== undefined
      ? formatUsd(usdExactCents, locale)
      : usdRate !== null
        ? formatApproxUsd(convertCents(audCents, usdRate), locale)
        : null;

  // AUD-only fallback: render exactly like a single-currency amount.
  if (usd === null) {
    return (
      <span
        className={`tnum text-right font-bold text-ink ${
          size === "lg" ? "text-sm" : "text-[13px]"
        }`}
      >
        {aud}
      </span>
    );
  }

  const audActive = active === "AUD";
  const primaryClass =
    size === "lg" ? "text-sm font-bold" : "text-[13px] font-bold";
  const secondaryClass = "text-[11px] font-semibold";

  const audLine = (
    <span
      key="aud"
      className={`tnum ${audActive ? `${primaryClass} text-ink` : `${secondaryClass} text-ink-3`}`}
    >
      {aud}
    </span>
  );
  const usdLine = (
    <span
      key="usd"
      className={`tnum ${!audActive ? `${primaryClass} text-ink` : `${secondaryClass} text-ink-3`}`}
    >
      {usd}
    </span>
  );

  return (
    <div className="flex flex-col items-end leading-tight">
      {audActive ? (
        <>
          {audLine}
          {usdLine}
        </>
      ) : (
        <>
          {usdLine}
          {audLine}
        </>
      )}
    </div>
  );
}
