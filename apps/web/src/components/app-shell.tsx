"use client";

// Auth-dependent shell. Nothing renders until onAuthStateChanged resolves
// (no logged-out flash); route gating here is COSMETIC — the Firestore
// security rules are the actual boundary.

import type { ReactNode } from "react";

import { useAuth, useHousehold, useUserDoc } from "@/components/providers";
import { Onboarding } from "@/components/onboarding/onboarding";
import { Sidebar } from "@/components/sidebar";
import { NewPeriodSheet } from "@/components/new-period-sheet";
import { PiggyMark } from "@/components/brand";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex h-[64px] w-[64px] animate-pulse items-center justify-center rounded-[20px] bg-accent shadow-[0_12px_28px_rgba(255,92,57,.35)]">
        <PiggyMark size={44} variant="cream" />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();
  const { userDoc, loading: userLoading } = useUserDoc();
  const {
    household,
    loading: householdLoading,
    currentPeriod,
    newPeriodStart,
  } = useHousehold();

  if (initializing || (user !== null && userLoading)) {
    return <LoadingScreen />;
  }

  if (user === null) {
    return <Onboarding stage="login" />;
  }

  if (userDoc?.householdId == null) {
    return <Onboarding stage="household" />;
  }

  if (household === null) {
    return householdLoading ? <LoadingScreen /> : <Onboarding stage="household" />;
  }

  const showNewPeriodSheet =
    newPeriodStart !== null &&
    currentPeriod !== null &&
    currentPeriod.startDate === newPeriodStart;

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1176px] px-8 py-[26px]">{children}</div>
      </main>
      {showNewPeriodSheet && <NewPeriodSheet period={currentPeriod} />}
    </div>
  );
}
