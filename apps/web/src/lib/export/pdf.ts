// Branded PDF export of an expense list.
//
// jsPDF is loaded through a DYNAMIC import so it never lands in the app's
// first-load bundle — it is code-split into its own lazy chunk that is only
// fetched the first time someone exports a PDF. Keep it that way: no
// top-level `import ... from "jspdf"`.
//
// The document uses jsPDF's built-in Helvetica (WinAnsi / Latin-1), which
// covers Spanish accents, "ñ" and "$", so no font embedding is needed.

import { formatCents, formatUsd } from "../money";

export interface PdfExpenseRow {
  date: string;
  categoryLabel: string;
  note: string;
  memberLabel: string;
  amountCents: number;
  /** What the bank charged in USD; null while the expense is unverified. */
  usdCents: number | null;
}

export interface PdfCategoryTotal {
  label: string;
  amountCents: number;
  /** USD sum of this category's VERIFIED expenses only. */
  usdCents: number;
}

export interface PdfExportOptions {
  filename: string;
  /** Document title (brand): "Gastos Diarios". */
  title: string;
  householdName: string;
  /** Human date range, e.g. "1 – 14 jul 2026". */
  rangeLabel: string;
  rows: PdfExpenseRow[];
  categoryTotals: PdfCategoryTotal[];
  grandTotalCents: number;
  /** USD sum of the VERIFIED expenses in the range. */
  grandTotalUsdCents: number;
  /** How many exported expenses have no bank USD charge yet. */
  unverifiedCount: number;
  currency: string;
  locale: string;
  /** Localized column headers + section headings. */
  labels: {
    date: string;
    category: string;
    note: string;
    person: string;
    amount: string;
    amountUsd: string;
    byCategory: string;
    total: string;
    countLine: string; // e.g. "24 gastos"
    /** Printed under the total when `unverifiedCount > 0`. */
    unverifiedNotice: string;
  };
}

// A4 in points, with comfortable margins.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 62;

// Coral accent (#FF5C39) and ink (#241A10) from the design tokens.
const CORAL: [number, number, number] = [255, 92, 57];
const INK: [number, number, number] = [36, 26, 16];
const MUTED: [number, number, number] = [143, 130, 114];

// Column x-offsets (from the left margin) and widths.
// Two money columns now: AUD, then the bank's USD at the content edge.
const USD_W = 74;
const COLS = {
  date: { x: 0, w: 66 },
  category: { x: 72, w: 82 },
  note: { x: 160, w: 152 },
  person: { x: 318, w: 58 },
  amount: { x: CONTENT_W - USD_W, w: 0 }, // right-aligned
  usd: { x: CONTENT_W, w: 0 }, // right-aligned at the content edge
};

export async function exportExpensesPdf(opts: PdfExportOptions): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const money = (cents: number) => formatCents(cents, opts.currency, opts.locale);
  const usd = (cents: number) => formatUsd(cents, opts.locale);

  const drawHeader = () => {
    doc.setFillColor(...CORAL);
    doc.rect(0, 0, PAGE_W, HEADER_H, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(opts.title, MARGIN, 38);
  };

  const drawTableHead = (y: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(opts.labels.date.toUpperCase(), MARGIN + COLS.date.x, y);
    doc.text(opts.labels.category.toUpperCase(), MARGIN + COLS.category.x, y);
    doc.text(opts.labels.note.toUpperCase(), MARGIN + COLS.note.x, y);
    doc.text(opts.labels.person.toUpperCase(), MARGIN + COLS.person.x, y);
    doc.text(opts.labels.amount.toUpperCase(), MARGIN + COLS.amount.x, y, {
      align: "right",
    });
    doc.text(opts.labels.amountUsd.toUpperCase(), MARGIN + COLS.usd.x, y, {
      align: "right",
    });
    doc.setDrawColor(220, 214, 204);
    doc.setLineWidth(0.7);
    doc.line(MARGIN, y + 6, PAGE_W - MARGIN, y + 6);
    return y + 20;
  };

  // Header band + document meta.
  drawHeader();
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(opts.householdName, MARGIN, HEADER_H + 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(opts.rangeLabel, MARGIN, HEADER_H + 44);
  doc.text(opts.labels.countLine, PAGE_W - MARGIN, HEADER_H + 44, {
    align: "right",
  });

  let y = HEADER_H + 74;
  y = drawTableHead(y);

  // Expense rows, paginating when we run past the bottom margin.
  doc.setFontSize(9);
  for (const r of opts.rows) {
    if (y > PAGE_H - MARGIN - 30) {
      doc.addPage();
      drawHeader();
      y = HEADER_H + 30;
      y = drawTableHead(y);
      doc.setFontSize(9);
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(r.date, MARGIN + COLS.date.x, y);
    doc.text(fit(doc, r.categoryLabel, COLS.category.w), MARGIN + COLS.category.x, y);
    doc.text(fit(doc, r.note, COLS.note.w), MARGIN + COLS.note.x, y);
    doc.setTextColor(...MUTED);
    doc.text(fit(doc, r.memberLabel, COLS.person.w), MARGIN + COLS.person.x, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(money(r.amountCents), MARGIN + COLS.amount.x, y, { align: "right" });
    // An unverified expense prints a muted dash, never a converted figure —
    // the app has no rate and the bank's is the only one that counts.
    if (r.usdCents === null) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text("—", MARGIN + COLS.usd.x, y, { align: "right" });
    } else {
      doc.text(usd(r.usdCents), MARGIN + COLS.usd.x, y, { align: "right" });
    }
    y += 16;
  }

  // Per-category totals block.
  y += 12;
  if (y > PAGE_H - MARGIN - 80) {
    doc.addPage();
    drawHeader();
    y = HEADER_H + 30;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(opts.labels.byCategory, MARGIN, y);
  y += 16;
  doc.setFontSize(9.5);
  for (const c of opts.categoryTotals) {
    if (y > PAGE_H - MARGIN - 30) {
      doc.addPage();
      drawHeader();
      y = HEADER_H + 30;
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(fit(doc, c.label, 260), MARGIN, y);
    doc.setFont("helvetica", "bold");
    doc.text(money(c.amountCents), MARGIN + COLS.amount.x, y, { align: "right" });
    if (c.usdCents > 0) {
      doc.text(usd(c.usdCents), PAGE_W - MARGIN, y, { align: "right" });
    }
    y += 15;
  }

  // Grand total.
  y += 6;
  doc.setDrawColor(...CORAL);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(opts.labels.total, MARGIN, y);
  doc.setTextColor(...CORAL);
  doc.text(money(opts.grandTotalCents), MARGIN + COLS.amount.x, y, {
    align: "right",
  });
  if (opts.grandTotalUsdCents > 0) {
    doc.text(usd(opts.grandTotalUsdCents), PAGE_W - MARGIN, y, {
      align: "right",
    });
  }

  // Say it plainly when the USD column is incomplete: the AUD total is the
  // whole range, the USD one only covers what the bank has reported.
  if (opts.unverifiedCount > 0) {
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(opts.labels.unverifiedNotice, PAGE_W - MARGIN, y, {
      align: "right",
    });
  }

  doc.save(opts.filename);
}

// jsPDF has no ellipsis helper; trim a string to fit a column width in pt.
function fit(
  doc: { getTextWidth: (s: string) => number },
  text: string,
  maxWidth: number,
): string {
  if (text === "" || doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(out + "…") > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
}
