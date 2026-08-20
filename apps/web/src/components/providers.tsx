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

import { AppErrorProvider } from "@/components/app-error";
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
import { fetchPeriodSpent } from "@/lib/firebase/hooks";
import { budgetCategoryIds, allCategoriesCount } from "@/lib/categories";
import {
  cascadeMaterialization,
  containsDate,
  todayInTimezone,
} from "@/lib/periods";
import { applyTheme, readStoredTheme } from "@/lib/theme";

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
  /** The period whose start-of-period screen is showing, and whether it was
   * opened by hand (which is the only case it may be closed unanswered). */
  startPeriodPrompt: { period: PeriodBudget; manual: boolean } | null;
  acknowledgeNewPeriod: () => void;
  /** Re-open the screen for the period under way — Ajustes' "Iniciar la
   * semana", for when it was answered by accident. */
  openStartPeriod: () => void;
}

const HouseholdContext = createContext<HouseholdContextValue>({
  household: null,
  loading: true,
  periods: [],
  periodsLoading: true,
  today: null,
  currentPeriod: null,
  startPeriodPrompt: null,
  acknowledgeNewPeriod: () => undefined,
  openStartPeriod: () => undefined,
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
  /* Theme — the inline script in layout.tsx already set data-theme before
   * paint; re-applying here also syncs <meta name="theme-color">. */
  useEffect(() => {
    applyTheme(readStoredTheme());
  }, []);

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
    return onSnapshot(
      ref,
      (snap) => {
        setUserState({
          userDoc: snap.exists() ? snap.data() : null,
          loading: false,
        });
      },
      // Without this the success handler never runs, `loading` stays true for
      // ever and every page bails on its `=== null` guard: a blank screen with
      // no spinner, no message and nothing to tap.
      (error) => {
        console.error("[gastos] users listener", error);
        setUserState({ userDoc: null, loading: false });
      },
    );
  }, [uid, auth.initializing]);

  // Create users/{uid} on first sign-in.
  useEffect(() => {
    if (uid === null || auth.user === null) return;
    const fb = getFirebaseClient();
    if (fb === null) return;
    // Logged rather than surfaced: this effect lives ABOVE AppErrorProvider, so
    // there is no dialog to reach from here. If it fails there is no user doc,
    // which the app already shows as onboarding rather than as a wrong number.
    void ensureUserDoc(fb.db, uid, auth.user.displayName ?? "").catch((error) => {
      console.error("[gastos] ensureUserDoc", error);
    });
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
    return onSnapshot(
      ref,
      (snap) => {
        setHouseholdState({
          household: snap.exists() ? snap.data() : null,
          loading: false,
        });
      },
      // Of the three this is the one that decides whether the app exists at all.
      (error) => {
        console.error("[gastos] household listener", error);
        setHouseholdState({ household: null, loading: false });
      },
    );
  }, [householdId, uid, userState.loading]);

  /* Period budgets: bounded window of the most recent periods. */
  const [periodState, setPeriodState] = useState<{
    periods: PeriodBudget[];
    loading: boolean;
    /** Whether this snapshot is still the local cache, not the server's word.
     * Materialization must not act on it — see below. */
    fromCache: boolean;
  }>({ periods: [], loading: true, fromCache: true });
  useEffect(() => {
    if (householdId === null) {
      setPeriodState({ periods: [], loading: false, fromCache: true });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    setPeriodState({ periods: [], loading: true, fromCache: true });
    const q = query(
      collection(fb.db, "households", householdId, "periodBudgets"),
      orderBy("startDate", "desc"),
      limit(8),
    ).withConverter(periodBudgetConverter);
    // includeMetadataChanges so the cache→server transition arrives even when
    // the documents are identical. Without it that event never fires, and a
    // materialization gated on `fromCache` would simply never run.
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const periods = snap.docs.map((d) => d.data()).reverse();
        setPeriodState({
          periods,
          loading: false,
          fromCache: snap.metadata.fromCache,
        });
      },
      // fromCache stays true on failure ON PURPOSE: materialization is gated on
      // it, and a failed read must never be mistaken for the server saying
      // there are no periods — that would materialize a duplicate.
      (error) => {
        console.error("[gastos] periodBudgets listener", error);
        setPeriodState({ periods: [], loading: false, fromCache: true });
      },
    );
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
  /** The period the user has already answered for, hydrated from storage.
   * `undefined` means "not read yet" — distinct from "nothing stored". */
  const [ackedStart, setAckedStart] = useState<string | null | undefined>(
    undefined,
  );
  const [manualStartPeriod, setManualStartPeriod] = useState(false);
  const materializing = useRef<string | null>(null);
  const household = householdState.household;
  useEffect(() => {
    if (householdId === null) {
      setAckedStart(undefined);
      return;
    }
    try {
      setAckedStart(localStorage.getItem(newPeriodAckKey(householdId)));
    } catch {
      setAckedStart(null);
    }
  }, [householdId]);
  const lastPeriod =
    periodState.periods.length > 0
      ? periodState.periods[periodState.periods.length - 1]
      : null;
  useEffect(() => {
    if (
      household === null ||
      householdId === null ||
      today === null ||
      periodState.loading ||
      // NEVER materialize from the offline cache. A period's endDate used to be
      // immutable, so a stale copy chained to the same answer as a fresh one —
      // extending a week into a fortnight ended that. A client opening on a
      // cache written before an extension sees the OLD end date, decides the
      // period is over, and writes a phantom period overlapping the real one.
      // That happened: a 2026-08-14 week appeared inside a fortnight running to
      // 2026-08-20. The rules cannot catch it (the create is well formed), so
      // the guard belongs here.
      periodState.fromCache
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
    // With rollover on, whatever was left of the period that just ended is
    // added to the new one (a deficit carries too — the envelope has to add
    // up). One server-side sum, so this costs a single read.
    const carryover = async (): Promise<number> => {
      if (household.defaultBudget.rollover !== true || lastPeriod === null) {
        return 0;
      }
      const categoryIds = allCategoriesCount(household.categories)
        ? null
        : budgetCategoryIds(household.categories);
      try {
        const spent = await fetchPeriodSpent(
          fb.db,
          householdId,
          { startDate: lastPeriod.startDate, endDate: lastPeriod.endDate },
          categoryIds,
        );
        return lastPeriod.amountCents - spent;
      } catch {
        return 0; // offline or denied — start the period on its plain budget
      }
    };

    void carryover()
      .then((rolloverCents) =>
        materializePeriods(
          fb.db,
          householdId,
          missing,
          household.defaultBudget.period,
          household.defaultBudget.amountCents,
          rolloverCents,
        ),
      )
      .catch(() => {
        materializing.current = null;
      });
  }, [household, householdId, today, periodState.loading, periodState.fromCache, lastPeriod]);

  const currentPeriod = useMemo(() => {
    if (today === null) return null;
    return periodState.periods.find((p) => containsDate(p, today)) ?? null;
  }, [periodState.periods, today]);

  /* First run with this household (a fresh browser, the other member joining):
   * mark the period under way as answered rather than asking about a period
   * that started before this device ever saw it. */
  useEffect(() => {
    if (householdId === null || currentPeriod === null) return;
    if (ackedStart !== null) return; // undefined = not read yet; a value = set
    ackNewPeriod(householdId, currentPeriod.startDate);
    setAckedStart(currentPeriod.startDate);
  }, [householdId, currentPeriod, ackedStart]);

  const acknowledgeNewPeriod = useCallback(() => {
    if (householdId !== null && currentPeriod !== null) {
      ackNewPeriod(householdId, currentPeriod.startDate);
      setAckedStart(currentPeriod.startDate);
    }
    setManualStartPeriod(false);
  }, [householdId, currentPeriod]);

  const openStartPeriod = useCallback(() => {
    if (currentPeriod !== null) setManualStartPeriod(true);
  }, [currentPeriod]);

  /* Ask on a period whose budget nobody has confirmed — the same rule iOS
   * uses, so it no longer matters WHICH client materialized it. */
  const startPeriodPrompt = useMemo(() => {
    if (currentPeriod === null || ackedStart === undefined) return null;
    if (manualStartPeriod) return { period: currentPeriod, manual: true };
    if (ackedStart === null || ackedStart === currentPeriod.startDate) {
      return null;
    }
    if (currentPeriod.source !== "default") return null;
    return { period: currentPeriod, manual: false };
  }, [currentPeriod, ackedStart, manualStartPeriod]);

  const householdValue = useMemo<HouseholdContextValue>(
    () => ({
      household,
      loading: householdState.loading,
      periods: periodState.periods,
      periodsLoading: periodState.loading,
      today,
      currentPeriod,
      startPeriodPrompt,
      acknowledgeNewPeriod,
      openStartPeriod,
    }),
    [
      household,
      householdState.loading,
      periodState.periods,
      periodState.loading,
      today,
      currentPeriod,
      startPeriodPrompt,
      acknowledgeNewPeriod,
      openStartPeriod,
    ],
  );

  return (
    <LocaleContext.Provider value={localeValue}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone={timezone ?? "Australia/Sydney"}
      >
        <AppErrorProvider>
          <AuthContext.Provider value={auth}>
            <UserDocContext.Provider value={userState}>
              <HouseholdContext.Provider value={householdValue}>
                {children}
              </HouseholdContext.Provider>
            </UserDocContext.Provider>
          </AuthContext.Provider>
        </AppErrorProvider>
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
