"use client";

// Client provider stack: locale (cookie + user-doc driven) → next-intl →
// Firebase auth → user doc → household (+ lazy period materialization).
// Firebase is initialized ONLY here, in the browser.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import esMessages from "../../messages/es.json";
import enMessages from "../../messages/en.json";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  householdConverter,
  periodBudgetConverter,
  userConverter,
  type Household,
  type PeriodBudget,
  type UserDoc,
} from "@/lib/firebase/converters";
import { ensureUserDoc, materializePeriods } from "@/lib/firebase/mutations";
import {
  cascadeMaterialization,
  containsDate,
  todayInTimezone,
} from "@/lib/periods";

export type Locale = "es" | "en";

const MESSAGES: Record<Locale, AbstractIntlMessages> = {
  es: esMessages as AbstractIntlMessages,
  en: enMessages as AbstractIntlMessages,
};

const LOCALE_COOKIE = "gd_locale";

/* ── Locale ────────────────────────────────────────────────────────────── */

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "es",
  setLocale: () => undefined,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

function readCookieLocale(): Locale | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE}=(es|en)`),
  );
  return match ? (match[1] as Locale) : null;
}

/* ── Auth ──────────────────────────────────────────────────────────────── */

interface AuthContextValue {
  user: User | null;
  /** True until the FIRST onAuthStateChanged resolution — nothing
   * auth-dependent renders before this (no logged-out flash). */
  initializing: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  initializing: true,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/* ── User doc ──────────────────────────────────────────────────────────── */

interface UserDocContextValue {
  userDoc: UserDoc | null;
  loading: boolean;
}

const UserDocContext = createContext<UserDocContextValue>({
  userDoc: null,
  loading: true,
});

export function useUserDoc(): UserDocContextValue {
  return useContext(UserDocContext);
}

/* ── Household ─────────────────────────────────────────────────────────── */

interface HouseholdContextValue {
  household: Household | null;
  loading: boolean;
  /** Materialized periods, ascending by startDate (bounded window). */
  periods: PeriodBudget[];
  periodsLoading: boolean;
  /** Today's calendar date in the household timezone. */
  today: string | null;
  currentPeriod: PeriodBudget | null;
  /** Start date of a period this client just materialized covering today —
   * drives the "new period" confirmation sheet. */
  newPeriodStart: string | null;
  acknowledgeNewPeriod: () => void;
}

const HouseholdContext = createContext<HouseholdContextValue>({
  household: null,
  loading: true,
  periods: [],
  periodsLoading: true,
  today: null,
  currentPeriod: null,
  newPeriodStart: null,
  acknowledgeNewPeriod: () => undefined,
});

export function useHousehold(): HouseholdContextValue {
  return useContext(HouseholdContext);
}

function newPeriodAckKey(householdId: string): string {
  return `gd:newPeriodAck:${householdId}`;
}

/** Suppress the new-period sheet for a given period (e.g. right after
 * onboarding, where the budget was just chosen). */
export function ackNewPeriod(householdId: string, startDate: string): void {
  try {
    localStorage.setItem(newPeriodAckKey(householdId), startDate);
  } catch {
    // Storage unavailable — the sheet may just show once more.
  }
}

/* ── Provider implementation ───────────────────────────────────────────── */

export function Providers({ children }: { children: ReactNode }) {
  /* Locale — Spanish by default; English only by explicit user choice
   * (settings toggle → cookie / user doc), never from the browser locale. */
  const [locale, setLocaleState] = useState<Locale>("es");
  useEffect(() => {
    const fromCookie = readCookieLocale();
    if (fromCookie !== null) {
      setLocaleState(fromCookie);
    }
  }, []);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  const localeValue = useMemo(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  /* Auth */
  const [auth, setAuth] = useState<AuthContextValue>({
    user: null,
    initializing: true,
  });
  useEffect(() => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    return onAuthStateChanged(fb.auth, (user) => {
      setAuth({ user, initializing: false });
    });
  }, []);

  /* User doc */
  const uid = auth.user?.uid ?? null;
  const [userState, setUserState] = useState<UserDocContextValue>({
    userDoc: null,
    loading: true,
  });
  useEffect(() => {
    if (uid === null) {
      setUserState({ userDoc: null, loading: auth.initializing });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setUserState({ userDoc: null, loading: true });
    const ref = doc(fb.db, "users", uid).withConverter(userConverter);
    return onSnapshot(ref, (snap) => {
      setUserState({
        userDoc: snap.exists() ? snap.data() : null,
        loading: false,
      });
    });
  }, [uid, auth.initializing]);

  // Create users/{uid} on first sign-in.
  useEffect(() => {
    if (uid === null || auth.user === null) return;
    const fb = getFirebaseClient();
    if (fb === null) return;
    void ensureUserDoc(fb.db, uid, auth.user.displayName ?? "");
  }, [uid, auth.user]);

  // Follow the user's stored language preference.
  const storedLanguage = userState.userDoc?.language ?? null;
  useEffect(() => {
    if (storedLanguage !== null && storedLanguage !== locale) {
      setLocale(storedLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedLanguage]);

  /* Household */
  const householdId = userState.userDoc?.householdId ?? null;
  const [householdState, setHouseholdState] = useState<{
    household: Household | null;
    loading: boolean;
  }>({ household: null, loading: true });
  useEffect(() => {
    if (householdId === null) {
      setHouseholdState({
        household: null,
        loading: uid !== null && userState.loading,
      });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setHouseholdState({ household: null, loading: true });
    const ref = doc(fb.db, "households", householdId).withConverter(
      householdConverter,
    );
    return onSnapshot(ref, (snap) => {
      setHouseholdState({
        household: snap.exists() ? snap.data() : null,
        loading: false,
      });
    });
  }, [householdId, uid, userState.loading]);

  /* Period budgets: bounded window of the most recent periods. */
  const [periodState, setPeriodState] = useState<{
    periods: PeriodBudget[];
    loading: boolean;
  }>({ periods: [], loading: true });
  useEffect(() => {
    if (householdId === null) {
      setPeriodState({ periods: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setPeriodState({ periods: [], loading: true });
    const q = query(
      collection(fb.db, "households", householdId, "periodBudgets"),
      orderBy("startDate", "desc"),
      limit(8),
    ).withConverter(periodBudgetConverter);
    return onSnapshot(q, (snap) => {
      const periods = snap.docs.map((d) => d.data()).reverse();
      setPeriodState({ periods, loading: false });
    });
  }, [householdId]);

  /* Today in the household timezone, refreshed every minute. */
  const timezone = householdState.household?.timezone ?? null;
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    if (timezone === null) {
      setToday(null);
      return;
    }
    const update = () => setToday(todayInTimezone(new Date(), timezone));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [timezone]);

  /* Lazy cascade materialization of missing periods. */
  const [newPeriodStart, setNewPeriodStart] = useState<string | null>(null);
  const materializing = useRef<string | null>(null);
  const household = householdState.household;
  const lastPeriod =
    periodState.periods.length > 0
      ? periodState.periods[periodState.periods.length - 1]
      : null;
  useEffect(() => {
    if (
      household === null ||
      householdId === null ||
      today === null ||
      periodState.loading
    ) {
      return;
    }
    const missing = cascadeMaterialization(
      lastPeriod !== null
        ? { startDate: lastPeriod.startDate, endDate: lastPeriod.endDate }
        : null,
      household.defaultBudget.anchorDate,
      household.defaultBudget.period,
      today,
    );
    if (missing.length === 0) return;
    const firstStart = missing[0].startDate;
    if (materializing.current === firstStart) return;
    materializing.current = firstStart;

    const fb = getFirebaseClient();
    if (fb === null) return;
    void materializePeriods(
      fb.db,
      householdId,
      missing,
      household.defaultBudget.period,
      household.defaultBudget.amountCents,
    )
      .then(() => {
        const current = missing.find((p) => containsDate(p, today));
        if (current === undefined) return;
        let acked: string | null = null;
        try {
          acked = localStorage.getItem(newPeriodAckKey(householdId));
        } catch {
          acked = null;
        }
        if (acked !== current.startDate) {
          setNewPeriodStart(current.startDate);
        }
      })
      .catch(() => {
        materializing.current = null;
      });
  }, [household, householdId, today, periodState.loading, lastPeriod]);

  const acknowledgeNewPeriod = useCallback(() => {
    if (householdId !== null && newPeriodStart !== null) {
      ackNewPeriod(householdId, newPeriodStart);
    }
    setNewPeriodStart(null);
  }, [householdId, newPeriodStart]);

  const currentPeriod = useMemo(() => {
    if (today === null) return null;
    return periodState.periods.find((p) => containsDate(p, today)) ?? null;
  }, [periodState.periods, today]);

  const householdValue = useMemo<HouseholdContextValue>(
    () => ({
      household,
      loading: householdState.loading,
      periods: periodState.periods,
      periodsLoading: periodState.loading,
      today,
      currentPeriod,
      newPeriodStart,
      acknowledgeNewPeriod,
    }),
    [
      household,
      householdState.loading,
      periodState.periods,
      periodState.loading,
      today,
      currentPeriod,
      newPeriodStart,
      acknowledgeNewPeriod,
    ],
  );

  return (
    <LocaleContext.Provider value={localeValue}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone={timezone ?? "Australia/Sydney"}
      >
        <AuthContext.Provider value={auth}>
          <UserDocContext.Provider value={userState}>
            <HouseholdContext.Provider value={householdValue}>
              {children}
            </HouseholdContext.Provider>
          </UserDocContext.Provider>
        </AuthContext.Provider>
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
