"use client";

// Servicios: what the household pays every month (or quarter, or year), how
// much, when it falls due and off which card.
//
// A register of RULES, and a check against what actually happened. The rules —
// name, amount, how often, which day — live here; the money lives in Gastos
// like everyone else's, as an expense in the Servicios category whose note is
// the service's name. This screen links the two by that name and reports the
// difference, because the expense is what the bank did and the rule is only
// what we expected.
//
// The two figures at the top are about THIS MONTH: what it costs, and how much
// of it has landed. They replace a "per month" average that counted a yearly
// bill as a twelfth of itself — arithmetically fine, and impossible to
// reconcile against any real month, which is the only thing anyone wanted.

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
  renameExpenseNote,
  updateService,
  type ServiceInput,
} from "@/lib/firebase/mutations";
import { formatCents, formatUsd } from "@/lib/money";
import { formatMonthLabel, formatShortDateInYear } from "@/lib/dates";
import {
  compareByDueDate,
  daysUntilDue,
  monthTotals,
  nextDueDate,
  serviceStatuses,
  unmatchedServiceExpenses,
  SERVICES_CATEGORY_ID,
  type ServiceStatus,
} from "@/lib/services";
import { monthRange } from "@/lib/periods";
import { UsdOverAud } from "@/components/charts";
import { updateHouseholdCategories } from "@/lib/firebase/mutations";
import { useExpensesRange } from "@/lib/firebase/hooks";

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

  // This month's expenses, so the register can be checked against the ledger.
  // Bounded by date like every other query in the app.
  const month = today === null ? null : monthRange(today);
  const { expenses } = useExpensesRange(
    household?.id ?? null,
    month?.startDate ?? null,
    month?.endDate ?? null,
  );

  const statuses = useMemo(
    () =>
      today === null
        ? new Map<string, ServiceStatus>()
        : serviceStatuses(services, expenses, Number(today.slice(5, 7))),
    [services, expenses, today],
  );

  // The Servicios expenses of the month that name no service — offered next
  // to whichever service is still waiting. See lib/services.ts.
  const unmatched = useMemo(
    () => unmatchedServiceExpenses(services, expenses),
    [services, expenses],
  );
  const totals = useMemo(
    () => monthTotals(services, statuses),
    [services, statuses],
  );

  if (household === null) return null;

  /** The category that makes an expense count as paying a service. */
  const hasServicesCategory =
    household.categories[SERVICES_CATEGORY_ID] !== undefined;

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
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
          {/* Which month it is. Every row here says "vence el 7" or "en 8
              días", and both are unreadable without knowing where you are. */}
          {today !== null && (
            <span className="text-[13px] font-semibold text-ink-3">
              {formatMonthLabel(today, locale)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2"
        >
          <Icon name="add" size={16} className="text-white" />
          <span className="text-[13px] font-bold text-white">{t("add")}</span>
        </button>
      </div>

      {/* What this month costs, and how much of it has already been charged.
          Two figures rather than one average: the second is the only one that
          can be checked against a bank statement. */}
      {services.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
            <span className="section-label">{t("chargedThisMonth")}</span>
            <span className="flex items-start">
              <UsdOverAud
                size="lg"
                usd={formatUsd(totals.chargedUsdCents, locale)}
                aud={formatCents(
                  totals.chargedAudCents,
                  household.currency,
                  locale,
                )}
                hasUsd={totals.chargedUsdCents > 0}
              />
            </span>
            <span className="text-[11.5px] text-ink-3">
              {t("chargedCount", {
                charged: totals.chargedCount,
                due: totals.dueCount,
              })}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
            <span className="section-label">{t("dueThisMonth")}</span>
            <span className="flex items-start">
              <UsdOverAud
                size="lg"
                usd={formatUsd(totals.dueUsdCents, locale)}
                aud={formatCents(totals.dueAudCents, household.currency, locale)}
                hasUsd={totals.dueUsdCents > 0}
              />
            </span>
            <span className="text-[11.5px] text-ink-3">{t("dueThisMonthHint")}</span>
          </div>
        </div>
      )}

      {/* Without the category there is nothing to link against, and every row
          below would report "pendiente" forever. One button rather than an
          instruction to go and do it somewhere else. */}
      {services.length > 0 && !hasServicesCategory && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-warn-bg px-[18px] py-3.5">
          <span className="flex flex-col gap-px">
            <span className="text-[13px] font-bold text-warn-text">
              {t("noCategoryTitle")}
            </span>
            <span className="text-[11.5px] font-semibold text-warn-text opacity-80">
              {t("noCategoryBody")}
            </span>
          </span>
          <button
            type="button"
            onClick={() =>
              withDb((db) =>
                updateHouseholdCategories(db, household.id, {
                  [SERVICES_CATEGORY_ID]: {
                    key: SERVICES_CATEGORY_ID,
                    icon: "receipt_long",
                    color: "#0E8F8F",
                    sortOrder: 7,
                  },
                }),
              )
            }
            className="rounded-full bg-accent px-4 py-2 text-[12.5px] font-bold text-white"
          >
            {t("noCategoryCta")}
          </button>
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
          const status = statuses.get(service.id);
          const charged = status?.charge ?? null;
          // Only a difference worth a person's attention. Zero means the bill
          // came in exactly as expected, which needs no words.
          const off = status?.differenceCents ?? 0;

          return (
            // A row, not a button: reconciling the amount is its own action,
            // and a button inside a button is invalid HTML.
            <div
              key={service.id}
              className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface px-[18px] py-3.5"
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(service)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
              </div>

              {/* Where this month stands. Three states and they are exclusive:
                  the month does not charge it, it has been charged, or it has
                  not yet. */}
              {status !== undefined && (
                <div className="flex flex-wrap items-center gap-2 border-t border-soft pt-2">
                  {!status.dueThisMonth ? (
                    <span className="text-[11.5px] font-semibold text-ink-3">
                      {t("notThisMonth")}
                    </span>
                  ) : charged !== null ? (
                    <>
                      <Icon
                        name="check_circle"
                        size={15}
                        style={{ color: "var(--good)" }}
                      />
                      <span className="text-[11.5px] font-semibold text-good-text">
                        {t("chargedOn", {
                          date: formatShortDateInYear(
                            charged.date,
                            today ?? charged.date,
                            locale,
                          ),
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon name="info" size={15} className="text-ink-3" />
                      <span className="text-[11.5px] font-semibold text-ink-3">
                        {t("notChargedYet")}
                      </span>
                    </>
                  )}

                  {/* Nothing is stored to link a service to its expense: the
                      NAME is the link. So an expense filed under Servicios
                      with the note the bill uses — "Amaysim Internet Casa" for
                      a service called "Internet Casa" — reads as never
                      charged, with nothing saying why and no way to fix it
                      from here. Reported exactly that way: "no encuentro la
                      manera de vincularlos".

                      Offering the unmatched ones next to the service that is
                      waiting turns that into one press: it renames the
                      expense's note to the service's name, which IS the
                      link. */}
                  {charged === null && unmatched.length > 0 && (
                    <div className="mt-1.5 flex w-full flex-col gap-1.5 border-t border-soft pt-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
                        {t("linkTitle")}
                      </span>
                      {unmatched.map((e) => (
                        <div key={e.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                            {e.note} ·{" "}
                            {formatCents(e.amountCents, household.currency, locale)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              withDb((db) =>
                                renameExpenseNote(db, household.id, e.id, service.name),
                              )
                            }
                            className="rounded-full border border-line px-3 py-1 text-[11.5px] font-bold text-ink-2"
                          >
                            {t("linkAction")}
                          </button>
                        </div>
                      ))}
                      <span className="text-[11px] text-ink-3">{t("linkHint")}</span>
                    </div>
                  )}

                  {/* The expense is what the bank did; the amount here is only
                      what we expected. So the fix always runs one way. */}
                  {charged !== null && off !== 0 && (
                    <>
                      <span
                        className="text-[11.5px] font-semibold"
                        style={{ color: "var(--warn-text)" }}
                      >
                        {t("chargedDifferent", {
                          amount: formatCents(
                            charged.amountCents,
                            household.currency,
                            locale,
                          ),
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          withDb((db) =>
                            updateService(db, household.id, service.id, {
                              name: service.name,
                              amountAudCents: charged.amountCents,
                              amountUsdCents: service.amountUsdCents,
                              interval: service.interval,
                              dueDay: service.dueDay,
                              anchorMonth: service.anchorMonth,
                              paidWith: service.paidWith,
                            }),
                          )
                        }
                        className="ml-auto rounded-full border border-line px-3 py-1 text-[11.5px] font-bold text-ink-2"
                      >
                        {t("useCharged")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
