// CSV export/import helpers shared by the Gastos and Datos pages.
//
// The app's canonical CSV shape (also what the importer round-trips):
//   header:  fecha,categoria,nota,monto_aud,moneda,monto_original,creado_por
//   monto_aud: canonical AUD, dot-decimal ("12.50").
//   moneda:    the entry currency ("AUD" | "USD") the amount was typed in.
//   monto_original: the amount in `moneda`, dot-decimal — equal to monto_aud
//                   for AUD rows, the original USD figure for USD rows, so an
//                   export→import round-trip preserves the entered currency.
//   amount:  dot-decimal, fields quoted when they contain a comma/quote/
//            newline, rows joined with CRLF, and a leading UTF-8 BOM so Excel
//            detects the encoding (accents in notes/names).
//
// No CSV-parsing dependency: parseCsv below is a small RFC-4180-ish parser.

/** One expense row for the CSV writer (money is integer cents). */
export interface CsvExpenseRow {
  date: string;
  categoryId: string;
  note: string;
  amountCents: number;
  createdBy: string;
  /** Entry currency the amount was typed in. Absent ⇒ AUD (canonical). */
  entryCurrency?: "AUD" | "USD";
  /** Original amount in `entryCurrency` (integer cents). Present iff USD. */
  entryAmountCents?: number;
}

export interface CsvBuildContext {
  /** Localized category display names ({ id, label }) — `key?t(key):name`. */
  categories: { id: string; label: string }[];
  /** uid → member display name. */
  members: Record<string, string>;
  /** Label used when a categoryId no longer exists in the household. */
  deletedLabel: string;
}

/** UTF-8 BOM: makes Excel/Numbers read the file as UTF-8. */
const BOM = "﻿";

/** The canonical column order. Exported so the importer can align to it. */
export const CSV_HEADER = [
  "fecha",
  "categoria",
  "nota",
  "monto_aud",
  "moneda",
  "monto_original",
  "creado_por",
] as const;

function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build the CSV text (BOM included) for a list of expenses. Amounts are
 * dot-decimal AUD; `categoria` and `creado_por` use localized display names.
 */
export function buildExpensesCsv(
  rows: CsvExpenseRow[],
  ctx: CsvBuildContext,
): string {
  const catLabel = new Map(ctx.categories.map((c) => [c.id, c.label]));
  const lines = [CSV_HEADER.join(",")];
  for (const e of rows) {
    const currency = e.entryCurrency ?? "AUD";
    // monto_original: the entered USD when present, otherwise the AUD itself.
    const originalCents = e.entryAmountCents ?? e.amountCents;
    lines.push(
      [
        e.date,
        escapeField(catLabel.get(e.categoryId) ?? ctx.deletedLabel),
        escapeField(e.note),
        (e.amountCents / 100).toFixed(2), // dot-decimal, never locale-grouped
        currency,
        (originalCents / 100).toFixed(2),
        escapeField(ctx.members[e.createdBy] ?? e.createdBy),
      ].join(","),
    );
  }
  return BOM + lines.join("\r\n");
}

/** Trigger a browser download of CSV text (adds the BOM if missing). */
export function downloadCsv(filename: string, text: string): void {
  const withBom = text.startsWith(BOM) ? text : BOM + text;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse CSV text into a grid of string rows. Handles quoted fields with
 * embedded commas, newlines and escaped (`""`) quotes, a leading BOM, and
 * both CRLF and LF line endings. A single trailing newline is ignored.
 */
export function parseCsv(text: string): string[][] {
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (input[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field/row unless the input ended exactly on a row break
  // (which already pushed the row and left an empty buffer).
  if (field !== "" || row.length > 0) endRow();

  return rows;
}
