/**
 * Which rows of an import are already in the ledger.
 *
 * Same date, amount, category and note (the note folded for case, accents and
 * space) is the same expense. The bank's USD is left out on purpose: an
 * expense verified since it was exported is still the one the file describes.
 * Each existing expense answers for ONE row, so two identical coffees in the
 * file against one in the ledger still import the second.
 */
export interface DedupeRow {
  date: string;
  amountCents: number;
  categoryId: string;
  note: string;
}

function key(row: DedupeRow): string {
  const note = row.note
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return `${row.date}|${row.amountCents}|${row.categoryId}|${note}`;
}

/** Indices of `rows` that an expense in `existing` already accounts for. */
export function alreadyThere(
  rows: readonly DedupeRow[],
  existing: readonly DedupeRow[],
): Set<number> {
  const available = new Map<string, number>();
  for (const expense of existing) {
    const k = key(expense);
    available.set(k, (available.get(k) ?? 0) + 1);
  }
  const found = new Set<number>();
  rows.forEach((row, index) => {
    const k = key(row);
    const left = available.get(k) ?? 0;
    if (left > 0) {
      available.set(k, left - 1);
      found.add(index);
    }
  });
  return found;
}
