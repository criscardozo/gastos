"use client";

// The rules, on the settings screen, next to the other registers.
//
// It lives here rather than on Servicios because it is not a bill: nothing in
// this list is due on a date, and nothing about it is summed. It is a set of
// instructions for what to do when the bank reports something we recognise.

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { RecurringRuleDialog } from "@/components/recurring-rule-dialog";
import { useAppError } from "@/components/app-error";
import { useAuth } from "@/components/providers";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useBankCharges, useRecurringRules } from "@/lib/firebase/hooks";
import {
  addRecurringRule,
  deleteRecurringRule,
  updateRecurringRule,
} from "@/lib/firebase/mutations";
import type { Household, RecurringRuleDoc } from "@/lib/firebase/converters";
import { isPending } from "@/lib/bank-charges";
import { formatCents } from "@/lib/money";

export function RecurringRulesCard({
  household,
  locale,
}: {
  household: Household;
  locale: string;
}) {
  const t = useTranslations("recurring");
  const tCat = useTranslations("categories");
  const { user } = useAuth();
  const { write } = useAppError();
  const { rules } = useRecurringRules(household.id);
  const { charges } = useBankCharges(household.id);

  const [editing, setEditing] = useState<RecurringRuleDoc | null>(null);
  const [adding, setAdding] = useState(false);

  const pendingMerchants = charges
    .filter(isPending)
    .map((c) => c.merchant)
    .filter((m) => m !== "");

  const label = (id: string) => {
    const def = household.categories[id];
    if (def === undefined) return id;
    return def.key !== undefined ? tCat(def.key) : def.name;
  };

  const close = () => {
    setEditing(null);
    setAdding(false);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <span className="section-label">{t("title")}</span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[11.5px] font-bold text-accent-strong"
        >
          {t("add")}
        </button>
      </div>
      <p className="px-1 text-[11.5px] text-ink-3">{t("subtitle")}</p>

      <div className="flex flex-col rounded-[20px] border border-line bg-surface">
        {rules.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-3">{t("empty")}</p>
        ) : (
          rules.map((rule, i) => (
            <button
              key={rule.id}
              type="button"
              onClick={() => setEditing(rule)}
              className={`flex items-center gap-3 px-4 py-3 text-left ${
                i > 0 ? "border-t border-line" : ""
              }`}
            >
              <Icon name="autorenew" size={17} className="flex-none text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-ink">
                  {rule.pattern}
                </span>
                <span className="truncate text-[12px] text-ink-3">
                  {rule.note} · {label(rule.categoryId)}
                </span>
              </span>
              <span className="tnum flex-none text-[13px] font-semibold text-ink-2">
                {rule.amountAudCents === null
                  ? t("amountAsk")
                  : formatCents(rule.amountAudCents, household.currency, locale)}
              </span>
            </button>
          ))
        )}
      </div>

      {(adding || editing !== null) && (
        <RecurringRuleDialog
          rule={editing}
          household={household}
          locale={locale}
          pendingMerchants={pendingMerchants}
          onSave={(input) => {
            const fb = getFirebaseClient();
            if (fb === null || user === null) return;
            write(
              editing === null
                ? addRecurringRule(fb.db, household.id, user.uid, input)
                : updateRecurringRule(fb.db, household.id, editing.id, input),
            );
            close();
          }}
          onDelete={
            editing === null
              ? null
              : () => {
                  const fb = getFirebaseClient();
                  if (fb === null) return;
                  write(deleteRecurringRule(fb.db, household.id, editing.id));
                  close();
                }
          }
          onClose={close}
        />
      )}
    </section>
  );
}
