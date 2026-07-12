"use client";

// Bi-currency budget entry shared by every budget editor (onboarding step 3,
// the new-period sheet and both Settings editors). The amount can be typed in
// AUD (default) or USD; USD is entry-time sugar only — on save the value is
// converted to AUD integer cents with the cached daily rate, so the stored
// doc is byte-identical in shape to an AUD-only save. The toggle is per-editor
// UI state and is never persisted. When no FX rate is available the controls
// render nothing and entry behaves exactly as AUD-only — FX never blocks.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Segmented } from "@/components/ui/segmented";
import { convertCents, fetchUsdRate, usdToAudCents } from "@/lib/fx";
import {
  formatApproxAud,
  formatApproxUsd,
  parseAmountToCents,
} from "@/lib/money";

export type EntryCurrency = "AUD" | "USD";

/** Per-editor entry-currency state plus the cached daily AUD→USD rate.
 * The rate resolves to null on total FX failure, which hides the toggle. */
export function useBudgetCurrency(): {
  currency: EntryCurrency;
  setCurrency: (currency: EntryCurrency) => void;
  usdRate: number | null;
} {
  const [currency, setCurrency] = useState<EntryCurrency>("AUD");
  const [usdRate, setUsdRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchUsdRate().then((rate) => {
      if (!cancelled) setUsdRate(rate);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { currency, setCurrency, usdRate };
}

/** Parse a typed amount and convert it to AUD integer cents for saving.
 * AUD input passes through; USD input is converted with the display rate
 * (Math.round). Returns null when unparsable or when USD was chosen but no
 * rate is available (cannot happen through the UI — the toggle is hidden). */
export function entryToAudCents(
  input: string,
  currency: EntryCurrency,
  usdRate: number | null,
): number | null {
  const cents = parseAmountToCents(input);
  if (cents === null) return null;
  if (currency === "AUD") return cents;
  return usdRate === null ? null : usdToAudCents(cents, usdRate);
}

/** AUD | USD toggle + live "≈ …" conversion badge rendered under an amount
 * field. Renders nothing when no FX rate is available so each editor falls
 * back to today's AUD-only behavior. */
export function BudgetCurrencyControls({
  amount,
  currency,
  onCurrencyChange,
  usdRate,
  locale,
  align = "center",
}: {
  amount: string;
  currency: EntryCurrency;
  onCurrencyChange: (currency: EntryCurrency) => void;
  usdRate: number | null;
  locale: string;
  align?: "center" | "end";
}) {
  const t = useTranslations("budgetEntry");
  if (usdRate === null) return null;

  const cents = parseAmountToCents(amount);
  const approx =
    cents === null
      ? null
      : currency === "AUD"
        ? formatApproxUsd(convertCents(cents, usdRate), locale)
        : formatApproxAud(usdToAudCents(cents, usdRate), locale);

  return (
    <div
      className={`flex flex-col gap-1.5 ${
        align === "end" ? "items-end" : "items-center"
      }`}
    >
      <Segmented<EntryCurrency>
        options={[
          { value: "AUD", label: "AUD" },
          { value: "USD", label: "USD" },
        ]}
        value={currency}
        onChange={onCurrencyChange}
        ariaLabel={t("currencyToggle")}
      />
      {approx !== null && (
        <span className="tnum rounded-full bg-fill px-2.5 py-0.5 text-xs font-semibold text-ink-2">
          {approx}
        </span>
      )}
    </div>
  );
}
