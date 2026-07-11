import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { serverTimestamp, type Firestore } from "firebase/firestore";

export const ALICE = "alice-uid";
export const BOB = "bob-uid";
export const CAROL = "carol-uid";
export const HOUSEHOLD = "household-test-1";
export const INVITE_CODE = "GD-7K2M9QX4"; // 10 chars — minimum allowed

const rulesPath = fileURLToPath(
  new URL("../../firestore.rules", import.meta.url),
);

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: "demo-gastos-diarios",
    firestore: { rules: readFileSync(rulesPath, "utf8") },
  });
}

export function db(env: RulesTestEnvironment, uid: string | null): Firestore {
  return (
    uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()
  ).firestore() as unknown as Firestore;
}

/** Valid `users/{uid}` payload. */
export function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Cristian",
    householdId: null,
    language: "es",
    displayCurrency: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Valid `households/{id}` payload with a single member. */
export function householdDoc(
  ownerUid: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name: "Cristian y Natalia",
    currency: "AUD",
    timezone: "Australia/Sydney",
    defaultBudget: {
      amountCents: 90000,
      period: "fortnightly",
      anchorDate: "2026-07-01",
    },
    memberIds: [ownerUid],
    memberProfiles: {
      [ownerUid]: { displayName: "Cristian", color: "#2A6FDB" },
    },
    categories: {
      groceries: {
        key: "groceries",
        icon: "shopping_basket",
        color: "#2E9E5B",
        sortOrder: 0,
      },
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Valid `expenses/{id}` payload. */
export function expenseDoc(
  createdBy: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    amountCents: 1250,
    categoryId: "groceries",
    note: "Verduras mercado",
    date: "2026-07-11",
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Valid `periodBudgets/{startDate}` payload. */
export function periodBudgetDoc(overrides: Record<string, unknown> = {}) {
  return {
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    period: "fortnightly",
    amountCents: 90000,
    source: "default",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Seed data bypassing rules. */
export async function seed(
  env: RulesTestEnvironment,
  writes: (dbAdmin: Firestore) => Promise<void>,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await writes(ctx.firestore() as unknown as Firestore);
  });
}
