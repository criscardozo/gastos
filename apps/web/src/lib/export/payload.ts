import { formatPeriodRange } from "../dates";
import type { Expense } from "../firebase/converters";
import type { PdfExportOptions } from "./pdf";

/**
 * The one payload every branded export renders — PDF, Excel and Sheets.
 *
 * It lived inside the Datos page, which is where the four export handlers still
 * are, and it is the only part of that group with arithmetic in it: the others
 * download a file or open a window. Pure, so it can be checked against cases
 * instead of through a screen — which is how `csv.ts` next door is already
 * tested, and why this belongs beside it rather than in a page.
 *
 * What it computes and nothing else does: the per-category totals, which the
 * three branded exports all show and none of them recalculates.
 */
export interface ExportPayloadInput {
  /** Exactly the rows on screen, in the order they are shown. */
  rows: Expense[];
  range: { startDate: string; endDate: string };
  /** `${base}.${extension}` becomes the filename. */
  fileBase: string;
  extension: string;
  household: { name: string; currency: string };
  /** A member's display name, by uid. Falls back to the uid. */
  memberNames: Record<string, string>;
  /** Resolves a category id to a label, deleted categories included. */
  catLabelOf: (id: string) => string;
  locale: string;
  totalCents: number;
  totalUsdCents: number;
  unverifiedCount: number;
  /**
   * next-intl's translator. Typed by what it is HANDED here rather than
   * importing its type: the only values passed are counts, and a looser
   * `unknown` does not satisfy its own index signature.
   */
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}

export function buildExportPayload({
  rows,
  range,
  fileBase,
  extension,
  household,
  memberNames,
  catLabelOf,
  locale,
  totalCents,
  totalUsdCents,
  unverifiedCount,
  t,
}: ExportPayloadInput): PdfExportOptions {
  const totalsMap = new Map<string, { aud: number; usd: number }>();
  for (const e of rows) {
    const prev = totalsMap.get(e.categoryId) ?? { aud: 0, usd: 0 };
    totalsMap.set(e.categoryId, {
      aud: prev.aud + e.amountCents,
      usd: prev.usd + (e.usdCents ?? 0),
    });
  }
  const categoryTotals = [...totalsMap.entries()]
    .map(([id, sums]) => ({
      label: catLabelOf(id),
      amountCents: sums.aud,
      usdCents: sums.usd,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  return {
    filename: `${fileBase}.${extension}`,
    title: "Gastos",
    householdName: household.name,
    rangeLabel: `${formatPeriodRange(range.startDate, range.endDate, locale, "short")} ${range.endDate.slice(0, 4)}`,
    rows: rows.map((e) => ({
      date: e.date,
      categoryLabel: catLabelOf(e.categoryId),
      note: e.note,
      memberLabel: memberNames[e.createdBy] ?? e.createdBy,
      amountCents: e.amountCents,
      usdCents: e.usdCents,
    })),
    categoryTotals,
    grandTotalCents: totalCents,
    grandTotalUsdCents: totalUsdCents,
    unverifiedCount,
    currency: household.currency,
    locale,
    labels: {
      date: t("colDate"),
      category: t("colCategory"),
      note: t("colNote"),
      person: t("colPerson"),
      amount: t("colAmount"),
      amountUsd: t("colAmountUsd"),
      byCategory: t("byCategory"),
      total: t("total"),
      countLine: t("expensesCount", { count: rows.length }),
      unverifiedNotice: t("unverifiedNotice", { count: unverifiedCount }),
    },
  };
}
