import { collection, getDocs, limit, orderBy, query, type Firestore } from "firebase/firestore";

// A one-shot read, not a listener, so it lives apart from hooks.ts: the guard
// in listener-limits.test.ts pairs every bounded query there with its iOS
// listener, and this has none to pair with.

/** How many reckonings Datos lists. A year of monthly ones, and then some. */
export const MAX_RECKONINGS = 24;

/**
 * The household's "Hacemos las cuentas" history, newest first, read once —
 * Datos is visited, not lived in — and bounded like every read here.
 */
export async function fetchReckonings(
  db: Firestore,
  householdId: string,
): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(db, "households", householdId, "reckonings"),
      orderBy("date", "desc"),
      limit(MAX_RECKONINGS),
    ),
  );
  return snap.docs.flatMap((d) => {
    const date: unknown = d.data().date;
    return typeof date === "string" ? [date] : [];
  });
}
