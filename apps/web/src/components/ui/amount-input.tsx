"use client";

// Big centered hero-style amount input ("$ 900") used in onboarding and the
// new-period sheet. Keeps a free-form string; the parent parses to cents.

import { useTranslations } from "next-intl";

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  fontSize?: number;
}

export function AmountInput({
  value,
  onChange,
  suffix,
  fontSize = 48,
}: AmountInputProps) {
  const t = useTranslations("a11y");
  return (
    <div className="tnum flex items-baseline justify-center gap-1">
      <span
        className="font-semibold text-ink-3"
        style={{ fontSize: Math.round(fontSize / 2) }}
      >
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size={Math.max(value.length, 1)}
        className="w-auto min-w-[2ch] border-none bg-transparent p-0 text-center font-bold tracking-[-0.03em] text-ink outline-none"
        style={{ fontSize, maxWidth: "8ch" }}
        // The one field on its screen, with a 48px caret blinking in it: that
        // is the focus indicator here, so the app-wide ring is turned off
        // rather than drawn around a hero number.
        aria-label={t("amount")}
      />
      {suffix !== undefined && (
        <span
          className="ml-1 font-semibold text-ink-3"
          style={{ fontSize: Math.round(fontSize / 3.2) }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
