"use client";

// Servicios: what the household pays every month (or quarter, or year), how
// much, when it falls due and off which card.
//
// A register, not a ledger: nothing here is summed against the weekly budget or
// shown in Estadísticas. The monthly total at the top is a summary of THIS
// screen — a yearly bill counted as a twelfth — and deliberately says nothing
// about the budget.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { CurrencyTag } from "@/components/ui/marks";
import { ServiceDialog } from "@/components/service-dialog";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useServices } from "@/lib/firebase/hooks";
import type { ServiceDoc } from "@/lib/firebase/converters";
import {
  addService,
  deleteService,
  updateService,
  type ServiceInput,
} from "@/lib/firebase/mutations";
import { formatCents, formatUsd } from "@/lib/money";
import { formatShortDateInYear } from "@/lib/dates";
import {
  compareByDueDate,
  daysUntilDue,
  monthlyTotals,
  nextDueDate,
} from "@/lib/services";

/** "Vence en 6 días" / "Vence hoy" / "Vence mañana". */
function useDueLabel() {
  const t = useTranslations("services");
  return (days: number): string => {
    if (days === 0) return t("dueToday");
    if (days === 1) return t("dueTomorrow");
    return t("dueInDays", { days });
  };
}

export default function ServicesPage() {
  const t = useTranslations("services");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { household, today } = useHousehold();
  const { services, loading } = useServices(household?.id ?? null);
  const dueLabel = useDueLabel();

  /** null = closed, "new" = adding, otherwise the service being edited. */
  const [editing, setEditing] = useState<ServiceDoc | "new" | null>(null);

  const sorted = useMemo(() => {
    if (today === null) return services;
    return [...services].sort(compareByDueDate(today));
  }, [services, today]);

  const totals = useMemo(() => monthlyTotals(services), [services]);

  if (household === null) return null;

  const withDb = (fn: (db: NonNullable<ReturnType<typeof getFirebaseClient>>["db"]) => Promise<void>) => {
    const fb = getFirebaseClient();
    // Fire and forget: Firestore only resolves a write once the SERVER
    // acknowledges it, so awaiting here would freeze the dialog offline while
    // the row is already saved locally.
    if (fb !== null) void fn(fb.db);
  };

  const save = (input: ServiceInput) => {
    if (user === null) return;
    if (editing === "new") {
      withDb((db) => addService(db, household.id, user.uid, input));
    } else if (editing !== null) {
      withDb((db) => updateService(db, household.id, editing.id, input));
    }
    setEditing(null);
  };

  return (
    <div className="mx-auto flex w-[660px] max-w-full flex-col gap-3.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2"
        >
          <Icon name="add" size={16} className="text-white" />
          <span className="text-[13px] font-bold text-white">{t("add")}</span>
        </button>
      </div>

      {/* Monthly cost of the whole register, per currency. */}
      {services.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface px-[18px] py-4">
          <span className="section-label">{t("perMonth")}</span>
          {/* USD first and biggest. Most of this register is billed by the
              card in dollars, so that is the figure being looked for; the AUD
              one is what the household pays locally, and reads underneath. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="tnum text-[26px] font-bold tracking-[-0.02em] text-ink">
                {formatUsd(totals.usdCents, locale)}
              </span>
              <CurrencyTag currency="USD" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="tnum text-[18px] font-bold text-ink-2">
                {formatCents(totals.audCents, household.currency, locale)}
              </span>
              <CurrencyTag currency="AUD" />
            </div>
          </div>
          <p className="text-[11.5px] text-ink-3">{t("perMonthHint")}</p>
        </div>
      )}

      {loading && services.length === 0 && (
        <p className="px-1 text-[13px] text-ink-3">{t("loading")}</p>
      )}

      {!loading && services.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[18px] border border-line bg-surface px-6 py-10 text-center">
          <Icon name="calendar_today" size={28} className="text-ink-3" />
          <span className="text-[15px] font-semibold text-ink">
            {t("emptyTitle")}
          </span>
          <span className="text-[12.5px] text-ink-3">{t("emptyBody")}</span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {sorted.map((service) => {
          const due = today !== null ? nextDueDate(service, today) : null;
          const days = today !== null ? daysUntilDue(service, today) : null;
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => setEditing(service)}
              className="flex items-center gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-3.5 text-left"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-bold text-ink">
                  {service.name}
                </span>
                <span className="truncate text-[11.5px] text-ink-3">
                  {t(`intervals.${service.interval}`)}
                  {due !== null &&
                    today !== null &&
                    ` · ${formatShortDateInYear(due, today, locale)}`}
                  {days !== null && ` · ${dueLabel(days)}`}
                </span>
              </div>

              <div className="flex flex-none flex-col items-end gap-0.5">
                {service.amountUsdCents !== null && (
                  <span className="tnum flex items-center gap-1.5 text-[14px] font-bold text-ink">
                    {formatUsd(service.amountUsdCents, locale)}
                    <CurrencyTag currency="USD" />
                  </span>
                )}
                {service.amountAudCents !== null && (
                  <span className="tnum flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                    {formatCents(
                      service.amountAudCents,
                      household.currency,
                      locale,
                    )}
                    <CurrencyTag currency="AUD" />
                  </span>
                )}
                <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-3">
                  {t(service.paidWith)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {editing !== null && today !== null && (
        <ServiceDialog
          service={editing === "new" ? null : editing}
          locale={locale}
          today={today}
          onSave={save}
          onDelete={
            editing === "new"
              ? null
              : () => {
                  withDb((db) => deleteService(db, household.id, editing.id));
                  setEditing(null);
                }
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
