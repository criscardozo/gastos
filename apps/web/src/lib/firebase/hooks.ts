"use client";

// Firestore listener hooks. Every expense listener is BOUNDED by a date
// range, and every useEffect returns its unsubscribe (StrictMode's double
// mount would otherwise duplicate onSnapshot and burn the free tier).

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { getFirebaseClient } from "./client";
import { expenseConverter, type Expense } from "./converters";

export interface ExpensesState {
  expenses: Expense[];
  loading: boolean;
}

/**
 * Live expenses for a household within [startDate, endDate] (inclusive,
 * lexicographic on the zero-padded date strings).
 */
export function useExpensesRange(
  householdId: string | null,
  startDate: string | null,
  endDate: string | null,
): ExpensesState {
  const [state, setState] = useState<ExpensesState>({
    expenses: [],
    loading: true,
  });

  useEffect(() => {
    if (householdId === null || startDate === null || endDate === null) {
      setState({ expenses: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(
      collection(fb.db, "households", householdId, "expenses"),
      where("date", ">=", startDate),
      where("date", "<=", endDate),
      orderBy("date", "desc"),
    ).withConverter(expenseConverter);
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({ expenses: snap.docs.map((d) => d.data()), loading: false });
      },
      () => setState({ expenses: [], loading: false }),
    );
    return unsubscribe;
  }, [householdId, startDate, endDate]);

  return state;
}
