"use client";

// What the services actually cost last month, to the cent: every Servicios
// expense of the calendar month before this one, with the bank's USD beside
// the verified ones and a total row. Read once — that month no longer changes,
// so a listener would keep paying for nothing. See lib/service-payments.ts.

import { useTranslations } from "next-intl";

import { useExpensesOnce } from "@/lib/firebase/hooks";
import { previousMonth, servicePayments } from "@/lib/service-payments";
import { formatCents, formatUsd } from "@/lib/money";
import { formatMonthLabel, formatShortDate } from "@/lib/dates";

export function LastMonthServices({
  householdId,
  today,
  currency,
  locale,
}: {
  householdId: string;
  today: string;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("services");
  const range = previousMonth(today);
  const { rows, loading, failed } = useExpensesOnce(
    householdId,
    range.startDate,
    range.endDate,
    "servicios last month",
  );
  const paid = servicePayments(rows);
  const money = (cents: number) => formatCents(cents, currency, locale);

  return (
    <section className="flex flex-col gap-2.5">
      <span className="section-label px-1">
        {t("lastMonthTitle", { month: formatMonthLabel(range.startDate, locale) })}
      </span>
      <div className="overflow-x-auto rounded-[18px] border border-line bg-surface">
        {loading ? (
          <p className="px-4 py-5 text-center text-[13px] text-ink-3">{t("loading")}</p>
        ) : failed ? (
          // Not the empty sentence: a read that failed says nothing about
          // whether anything was paid.
          <p className="px-4 py-5 text-center text-[13px] font-semibold text-over-text">
            {t("lastMonthFailed")}
          </p>
        ) : paid.rows.length === 0 ? (
          <p className="px-4 py-5 text-center text-[13px] text-ink-3">{t("lastMonthEmpty")}</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-soft text-ink-3">
                <th className="px-4 py-2 font-semibold">{t("colDate")}</th>
                <th className="px-3 py-2 font-semibold">{t("colService")}</th>
                <th className="px-3 py-2 text-right font-semibold">AUD</th>
                <th className="px-4 py-2 text-right font-semibold">{t("colUsdBank")}</th>
              </tr>
            </thead>
            <tbody>
              {paid.rows.map((e) => (
                <tr key={e.id} className="border-b border-soft last:border-b-0">
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-2">
                    {formatShortDate(e.date, locale)}
                  </td>
                  <td className="px-3 py-2 font-semibold text-ink">
                    {e.note !== "" ? e.note : t("noNote")}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right font-bold text-ink">
                    {money(e.amountCents)}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink-2">
                    {e.usdCents === null ? "—" : formatUsd(e.usdCents, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="px-4 py-2.5 font-bold text-ink" colSpan={2}>
                  {t("lastMonthTotal", { count: paid.rows.length })}
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[14px] font-bold text-ink">
                  {money(paid.totalAudCents)}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-right font-semibold text-ink-2">
                  {paid.totalUsdCents > 0 ? formatUsd(paid.totalUsdCents, locale) : "—"}
                </td>
              </tr>
              {paid.unverified > 0 && paid.totalUsdCents > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 pb-2.5 text-right text-[11.5px] text-ink-3">
                    {t("lastMonthUsdPartial", { count: paid.unverified })}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}
