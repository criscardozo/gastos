// Small identifying marks: which currency an amount is in, and which card a
// charge went on.
//
// Both are drawn here rather than fetched, for the same reason the icon set is
// inline SVG: the app has to render correctly offline as an installed PWA, and
// a logo that 404s in a tunnel is worse than no logo.
//
// The card marks are plain geometry — two interlocking circles, a wordmark —
// not the brands' official artwork. They exist to tell two rows apart at a
// glance in a two-person household ledger, nothing more.

import type { CardBrand } from "@/lib/statements";

/* ── Currency ──────────────────────────────────────────────────────────── */

/** Regional-indicator pair for a currency's country. */
const FLAGS: Record<string, string> = {
  AUD: "🇦🇺",
  USD: "🇺🇸",
};

/**
 * "🇦🇺 AUD" — the flag as the eye-catching part, the code as the part that is
 * still readable when a platform has no flag glyphs (Windows renders the
 * letters "AU", which is a perfectly good fallback).
 */
export function CurrencyTag({
  currency,
  className = "",
}: {
  currency: string;
  className?: string;
}) {
  const flag = FLAGS[currency];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.04em] text-ink-3 ${className}`}
    >
      {flag !== undefined && (
        <span aria-hidden className="text-[13px] leading-none">
          {flag}
        </span>
      )}
      {currency}
    </span>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

export const CARD_LABELS: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
};

/**
 * The brand mark at list size. Mastercard is its two interlocking circles;
 * Visa has no shape to speak of, so it is the wordmark set in its blue.
 */
export function CardMark({
  brand,
  size = 28,
}: {
  brand: CardBrand;
  size?: number;
}) {
  if (brand === "mastercard") {
    const height = Math.round(size * 0.62);
    return (
      <svg
        width={size}
        height={height}
        viewBox="0 0 48 30"
        role="img"
        aria-label={CARD_LABELS.mastercard}
        style={{ flex: "none" }}
      >
        <circle cx="18" cy="15" r="13" fill="#EB001B" />
        <circle cx="30" cy="15" r="13" fill="#F79E1B" />
        {/* The lens where they overlap — clipped to the left circle so the
            darker orange only shows inside both. */}
        <path
          d="M24 5.2a13 13 0 0 0 0 19.6 13 13 0 0 0 0-19.6Z"
          fill="#FF5F00"
        />
      </svg>
    );
  }
  return (
    <span
      role="img"
      aria-label={CARD_LABELS.visa}
      style={{ fontSize: Math.round(size * 0.46), flex: "none", color: "var(--visa)" }}
      className="font-black italic leading-none tracking-[-0.02em]"
    >
      VISA
    </span>
  );
}
