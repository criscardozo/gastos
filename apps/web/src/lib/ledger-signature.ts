/**
 * A string that changes exactly when the figures of a set of expenses do.
 *
 * What the month's server-side sum is refreshed on. It keys on what the sum
 * reads — which expenses, their amount, their date (a date can move an expense
 * out of the month) and their category (a category can stop counting) — and on
 * nothing else. In particular not on `pendingWrite`: the listeners report
 * metadata changes, so a queued write and its acknowledgement arrive as two
 * snapshots of the same figures, and keying on them would cost two reads for
 * one expense.
 *
 * Sorted, so the order a listener happens to deliver in is not a change.
 */
export function ledgerSignature(
  expenses: readonly {
    id: string;
    amountCents: number;
    date: string;
    categoryId: string;
  }[],
): string {
  return expenses
    .map((e) => `${e.id}:${e.amountCents}:${e.date}:${e.categoryId}`)
    .sort()
    .join("|");
}
