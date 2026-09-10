"use client";

// The filter bar's state, and the list it produces.
//
// Five pieces of state that are only ever read together — the category, the
// person, the verification status, the search box and grouped-or-flat — plus
// the one call that turns them into rows. They were spread through the 974
// lines of the Gastos screen with nothing marking them as a set, so reading
// any one of them meant checking whether the other four were involved.
//
// The arithmetic itself is NOT here: filtering, sorting and day-grouping live
// in lib/expense-list.ts and are tested there, against cases rather than
// through a screen. This is only the state and the wiring, which is what a
// hook is good for and a pure function is not.

import { useState } from "react";

import type { VerificationFilter } from "@/app/gastos/pieces";
import type { Expense } from "@/lib/firebase/converters";
import { visibleExpenses } from "@/lib/expense-list";

export type Grouping = "grouped" | "flat";

export interface ExpenseFilters {
  category: string;
  setCategory: (value: string) => void;
  person: string;
  setPerson: (value: string) => void;
  verification: VerificationFilter;
  setVerification: (value: VerificationFilter) => void;
  search: string;
  setSearch: (value: string) => void;
  grouping: Grouping;
  setGrouping: (value: Grouping) => void;
  /** The expenses that survive the filters, sorted. */
  rows: Expense[];
  /** Those same rows bucketed by day, for the grouped view. */
  days: ReturnType<typeof visibleExpenses>["days"];
  /** True when anything is narrowing the list — for the "clear" affordance. */
  active: boolean;
}

export function useExpenseFilters(expenses: readonly Expense[]): ExpenseFilters {
  const [category, setCategory] = useState("all");
  const [person, setPerson] = useState("all");
  const [verification, setVerification] = useState<VerificationFilter>("all");
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("grouped");

  const { rows, days } = visibleExpenses(expenses, {
    category,
    person,
    verification,
    search,
  });

  return {
    category,
    setCategory,
    person,
    setPerson,
    verification,
    setVerification,
    search,
    setSearch,
    grouping,
    setGrouping,
    rows,
    days,
    active:
      category !== "all" ||
      person !== "all" ||
      verification !== "all" ||
      search.trim() !== "",
  };
}
