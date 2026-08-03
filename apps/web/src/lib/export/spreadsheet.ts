// Branded spreadsheet export — the PDF's layout, as a real workbook.
//
// One builder serves both outputs: the .xlsx is downloaded as-is for Excel, or
// handed to Drive, which converts it to a Google Sheet keeping the formatting.
// So the two exports can never drift apart.
//
// exceljs is loaded through a DYNAMIC import so it stays out of the first-load
// bundle (same rule as jsPDF). Keep it that way: no top-level import.
//
// Amounts are written as NUMBERS with a currency format, not as pre-formatted
// strings — the whole point of a spreadsheet is that the reader can sum and
// filter them.

import type { PdfExportOptions } from "./pdf";

/** The spreadsheet takes exactly the PDF's inputs, so the two stay in step. */
export type SpreadsheetExportOptions = PdfExportOptions;

/* Design tokens, as the ARGB strings exceljs expects. */
const CORAL = "FFFF5C39";
const INK = "FF241A10";
const MUTED = "FF8F8272";
const LINE = "FFDCD6CC";
const SOFT = "FFFDEDE9"; // accent-soft, for the totals block
const WHITE = "FFFFFFFF";

/** es-AR style money format; en-AU falls back to the plain locale grouping. */
function numberFormat(currency: string, locale: string): string {
  const symbol = currency === "USD" ? "US$" : "$";
  return locale === "es"
    ? `"${symbol}"#,##0.00`
    : `"${symbol}"#,##0.00`;
}

/**
 * Builds the workbook and returns it as a Blob (xlsx). Mirrors the PDF: coral
 * header band, household + range meta, the expense table, per-category totals
 * and a coral-ruled grand total.
 */
export async function buildExpensesWorkbook(
  opts: SpreadsheetExportOptions,
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.title;
  wb.created = new Date();

  const money = numberFormat(opts.currency, opts.locale);
  const ws = wb.addWorksheet(opts.labels.byCategory ? opts.title : "Gastos", {
    views: [{ state: "frozen", ySplit: 6 }], // keep the table head in view
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true },
  });

  ws.columns = [
    { key: "date", width: 14 },
    { key: "category", width: 20 },
    { key: "note", width: 42 },
    { key: "person", width: 18 },
    { key: "amount", width: 16 },
  ];

  /* ── Header band (rows 1–2), the PDF's coral strip ────────────────────── */
  ws.mergeCells("A1:E2");
  const band = ws.getCell("A1");
  band.value = opts.title;
  band.font = { name: "Helvetica", size: 20, bold: true, color: { argb: WHITE } };
  band.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CORAL } };
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;

  /* ── Meta: household, range, count ────────────────────────────────────── */
  ws.mergeCells("A3:C3");
  const name = ws.getCell("A3");
  name.value = opts.householdName;
  name.font = { name: "Helvetica", size: 12, bold: true, color: { argb: INK } };
  name.alignment = { indent: 1 };

  ws.mergeCells("A4:C4");
  const range = ws.getCell("A4");
  range.value = opts.rangeLabel;
  range.font = { name: "Helvetica", size: 10, color: { argb: MUTED } };
  range.alignment = { indent: 1 };

  ws.mergeCells("D4:E4");
  const count = ws.getCell("D4");
  count.value = opts.labels.countLine;
  count.font = { name: "Helvetica", size: 10, color: { argb: MUTED } };
  count.alignment = { horizontal: "right" };

  ws.getRow(5).height = 6; // breathing room, like the PDF's gap

  /* ── Table head ───────────────────────────────────────────────────────── */
  const head = ws.getRow(6);
  head.values = [
    opts.labels.date.toUpperCase(),
    opts.labels.category.toUpperCase(),
    opts.labels.note.toUpperCase(),
    opts.labels.person.toUpperCase(),
    opts.labels.amount.toUpperCase(),
  ];
  head.eachCell((cell, col) => {
    cell.font = { name: "Helvetica", size: 8.5, bold: true, color: { argb: MUTED } };
    cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
    cell.alignment = { horizontal: col === 5 ? "right" : "left", indent: col === 1 ? 1 : 0 };
  });

  /* ── Expense rows ─────────────────────────────────────────────────────── */
  for (const r of opts.rows) {
    const row = ws.addRow([
      r.date,
      r.categoryLabel,
      r.note,
      r.memberLabel,
      r.amountCents / 100,
    ]);
    row.getCell(1).font = { name: "Helvetica", size: 9, color: { argb: INK } };
    row.getCell(1).alignment = { indent: 1 };
    row.getCell(2).font = { name: "Helvetica", size: 9, color: { argb: INK } };
    row.getCell(3).font = { name: "Helvetica", size: 9, color: { argb: INK } };
    row.getCell(4).font = { name: "Helvetica", size: 9, color: { argb: MUTED } };
    const amount = row.getCell(5);
    amount.font = { name: "Helvetica", size: 9, bold: true, color: { argb: INK } };
    amount.numFmt = money;
    amount.alignment = { horizontal: "right" };
  }

  // Filters over the table make the sheet genuinely useful, which a PDF can't be.
  if (opts.rows.length > 0) {
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + opts.rows.length, column: 5 } };
  }

  /* ── Per-category totals ──────────────────────────────────────────────── */
  ws.addRow([]);
  const byCategory = ws.addRow([opts.labels.byCategory]);
  byCategory.getCell(1).font = {
    name: "Helvetica", size: 11, bold: true, color: { argb: INK },
  };
  byCategory.getCell(1).alignment = { indent: 1 };

  for (const c of opts.categoryTotals) {
    const row = ws.addRow([c.label, null, null, null, c.amountCents / 100]);
    row.getCell(1).font = { name: "Helvetica", size: 9.5, color: { argb: INK } };
    row.getCell(1).alignment = { indent: 1 };
    const amount = row.getCell(5);
    amount.font = { name: "Helvetica", size: 9.5, bold: true, color: { argb: INK } };
    amount.numFmt = money;
    amount.alignment = { horizontal: "right" };
  }

  /* ── Grand total, under the PDF's coral rule ──────────────────────────── */
  const total = ws.addRow([
    opts.labels.total,
    null,
    null,
    null,
    opts.grandTotalCents / 100,
  ]);
  total.height = 22;
  total.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    cell.border = { top: { style: "medium", color: { argb: CORAL } } };
    cell.alignment = { vertical: "middle" };
  });
  total.getCell(1).font = {
    name: "Helvetica", size: 13, bold: true, color: { argb: INK },
  };
  total.getCell(1).alignment = { vertical: "middle", indent: 1 };
  const totalCell = total.getCell(5);
  totalCell.font = { name: "Helvetica", size: 13, bold: true, color: { argb: CORAL } };
  totalCell.numFmt = money;
  totalCell.alignment = { horizontal: "right", vertical: "middle" };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Saves the workbook to the user's downloads. */
export function downloadWorkbook(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
