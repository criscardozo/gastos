"use client";

// The app's single "active currency": the per-user `defaultEntryCurrency`
// (persisted). It seeds the expense-entry toggle AND drives the primary
// display currency across every screen (remaining, totals, list rows). When
// USD is active but no daily FX rate is available, display falls back to
// AUD-only — FX must never block. See CLAUDE.md (bi-currency, AUD canonical).

import { useEffect, useState } from "react";

import { useUserDoc } from "@/components/providers";
import { fetchUsdRate } from "@/lib/fx";

export type ActiveCurrency = "AUD" | "USD";

/** The user's chosen active currency (null default ⇒ AUD). This is the
 * intent; it may still fall back to AUD for display when no rate exists. */
export function useActiveCurrency(): ActiveCurrency {
  const { userDoc } = useUserDoc();
  return userDoc?.defaultEntryCurrency === "USD" ? "USD" : "AUD";
}

/** Daily AUD→USD display rate (cached in localStorage by day). null while
 * loading or on total FX failure. */
export function useUsdRate(): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchUsdRate().then((r) => {
      if (!cancelled) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return rate;
}

/** Resolve the currency actually used as primary in the UI: the active choice,
 * downgraded to AUD when USD is requested but no rate is available. */
export function effectiveCurrency(
  active: ActiveCurrency,
  usdRate: number | null,
): ActiveCurrency {
  return active === "USD" && usdRate !== null ? "USD" : "AUD";
}
