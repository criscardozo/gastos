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
import { useAuth, useHousehold } from "@/components/providers";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useBankCharges, useRecurringRules, useServices } from "@/lib/firebase/hooks";
import {
  addRecurringRule,
  deleteRecurringRule,
  fileRecurringExpense,
  updateRecurringRule,
  type RecurringRuleInput,
} from "@/lib/firebase/mutations";
import type { Household, RecurringRuleDoc } from "@/lib/firebase/converters";
import { isPending } from "@/lib/bank-charges";
import { learnRate } from "@/lib/bank-match";
import { claimsOfOneRule } from "@/lib/recurring";
import { useExpensesRange } from "@/lib/firebase/hooks";
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
  const { currentPeriod } = useHousehold();
  const { write } = useAppError();
  const { rules } = useRecurringRules(household.id);
  const { charges } = useBankCharges(household.id);
  // Only to learn the bank's rate, which is what prices a rule that states no
  // amount. Bounded by the current period's dates like every other expense
  // query — and it is the same query the summary runs, so in practice it is
  // served from the cache rather than costing a read.
  const { expenses } = useExpensesRange(
    household.id,
    currentPeriod?.startDate ?? null,
    currentPeriod?.endDate ?? null,
  );
  const learnedRate = learnRate(expenses);

  const [editing, setEditing] = useState<RecurringRuleDoc | null>(null);
  const [adding, setAdding] = useState(false);

  // Only while the dialog is open — see the same call on the Gastos screen.
  const servicesForRule = useServices(
    adding || editing !== null ? household.id : null,
  ).services;

  const pendingMerchants = charges
    .filter(isPending)
    .map((c) => c.merchant)
    .filter((m) => m !== "");

  const label = (id: string) => {
    const def = household.categories[id];
    if (def === undefined) return id;
    return def.key !== undefined ? tCat(def.key) : def.name;
  };

  /**
   * Save the rule and immediately file whatever it already recognises.
   *
   * The icon that opens this dialog sits ON a pending charge, so that charge is
   * the whole reason the rule exists — leaving it in the list until the next
   * launch made the rule look like it had not worked.
   */
  const saveAndApply = async (input: RecurringRuleInput, existingId?: string) => {
    const fb = getFirebaseClient();
    if (fb === null || user === null) return;
    const ruleId =
      existingId ??
      (await addRecurringRule(fb.db, household.id, user.uid, input));
    if (existingId !== undefined) {
      await updateRecurringRule(fb.db, household.id, existingId, input);
    }
    const pending = charges.filter(isPending);
    for (const claim of claimsOfOneRule(
      pending,
      { id: ruleId, ...input },
      learnedRate,
    )) {
      if (claim.amountAudCents === null) continue;
      await fileRecurringExpense(
        fb.db,
        household.id,
        user.uid,
        claim.charge,
        { id: ruleId, categoryId: input.categoryId, note: input.note },
        claim.amountAudCents,
        claim.estimated,
      );
    }
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
          services={servicesForRule}
          onSave={(input) => {
            write(saveAndApply(input, editing?.id));
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
