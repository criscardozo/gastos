"use client";

// New-period confirmation sheet (design 2a): shown right after this client
// materializes the period that covers today. The default amount is prefilled
// and editable; the period TYPE is already recorded (immutable by rules), so
// the segmented control is display-only here.

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { AmountInput } from "@/components/ui/amount-input";
import { Segmented } from "@/components/ui/segmented";
import { parseBudgetAmount } from "@/components/budget-amount-field";
import { getFirebaseClient } from "@/lib/firebase/client";
import { updatePeriodAmount } from "@/lib/firebase/mutations";
import { formatPeriodRange } from "@/lib/dates";
import type { PeriodBudget } from "@/lib/firebase/converters";

export function NewPeriodSheet({ period }: { period: PeriodBudget }) {
  const t = useTranslations("newPeriod");
  const tp = useTranslations("period");
  const { locale } = useLocale();
  const { household, acknowledgeNewPeriod } = useHousehold();

  const [amount, setAmount] = useState(() =>
    (period.amountCents / 100).toLocaleString(
      locale === "es" ? "es-AR" : "en-AU",
      { maximumFractionDigits: 2, useGrouping: false },
    ),
  );
  const [saving, setSaving] = useState(false);

  const weekly = period.period === "weekly";
  const cents = parseBudgetAmount(amount);
  const changed = cents !== null && cents !== period.amountCents;

  const confirm = async () => {
    const fb = getFirebaseClient();
    if (fb === null || household === null) {
      acknowledgeNewPeriod();
      return;
    }
    if (changed && cents !== null) {
      setSaving(true);
      try {
        await updatePeriodAmount(
          fb.db,
          household.id,
          period.startDate,
          cents,
        );
      } catch {
        // Keep going — the period exists with its default budget.
      }
    }
    acknowledgeNewPeriod();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(36,26,16,.35)" }}
      onClick={acknowledgeNewPeriod}
    >
      <div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-t-[30px] bg-bg px-[22px] pb-10 pt-3.5 shadow-[0_-10px_30px_rgba(36,26,16,.08)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-[5px] w-10 self-center rounded-[3px]"
          style={{ background: "var(--track)" }}
        />
        <div className="flex flex-col gap-[3px]">
          <span className="text-xl font-bold text-ink">
            {weekly ? t("titleWeekly") : t("titleFortnightly")}
          </span>
          <span className="text-[13.5px] text-ink-2">
            {t("subtitle", {
              range: formatPeriodRange(
                period.startDate,
                period.endDate,
                locale,
              ),
            })}
          </span>
        </div>

        <div className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-[18px]">
          <div className="flex items-center justify-center gap-2.5">
            <AmountInput
              value={amount}
              onChange={setAmount}
              fontSize={46}
            />
            <Icon name="edit" size={18} className="text-ink-3" />
          </div>
          <div className="flex items-center gap-[5px] self-center rounded-full bg-good-bg px-[11px] py-1">
            <span className="text-[11.5px] font-bold text-good-text">
              {changed ? t("adjustedBadge") : t("defaultBadge")}
            </span>
          </div>
          <Segmented
            options={[
              { value: "weekly", label: tp("weekly") },
              { value: "fortnightly", label: tp("fortnightly") },
            ]}
            value={period.period}
            size="lg"
            stretch
            disabled
          />
        </div>

        <p className="text-center text-xs leading-[1.45] text-ink-3">
          {t.rich(weekly ? "noteWeekly" : "noteFortnightly", {
            br: () => <br />,
          })}
        </p>

        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving || cents === null}
          className="flex h-14 items-center justify-center gap-2 rounded-full bg-accent text-base font-bold text-white shadow-[0_8px_20px_rgba(255,92,57,.35)] disabled:opacity-60"
        >
          <Icon name="check" size={20} className="text-white" />
          {weekly ? t("startWeekly") : t("startFortnightly")}
        </button>
      </div>
    </div>
  );
}
