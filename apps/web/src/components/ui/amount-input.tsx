"use client";

// Big centered hero-style amount input ("$ 900") used in onboarding and the
// new-period sheet. Keeps a free-form string; the parent parses to cents.

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
        aria-label="amount"
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
