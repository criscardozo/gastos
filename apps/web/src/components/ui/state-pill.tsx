"use client";

import { useTranslations } from "next-intl";

import type { BudgetState } from "@/lib/periods";

const STYLES: Record<BudgetState, { bg: string; color: string }> = {
  comfortable: { bg: "var(--good-bg)", color: "var(--good-text)" },
  warning: { bg: "var(--warn-bg)", color: "var(--warn-text)" },
  over: { bg: "var(--over-bg)", color: "var(--over-text)" },
};

/** "Van bien" / "Queda poco" / "Se pasaron" pill. */
export function StatePill({ state }: { state: BudgetState }) {
  const t = useTranslations("budgetState");
  const style = STYLES[state];
  return (
    <span
      className="rounded-full px-[11px] py-[5px] text-xs font-bold"
      style={{ background: style.bg, color: style.color }}
    >
      {t(state)}
    </span>
  );
}
