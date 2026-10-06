"use client";

/**
 * The one place the app tells you something went wrong after sign-in.
 *
 * Until now there was none. `onboarding.tsx` had a `setError` for the login and
 * the join flow, and past that point every failure was swallowed: eleven writes
 * fired with `void` and no `.catch`, five listeners answered an error by
 * setting an empty list, and three more had no error callback at all. So a
 * refused write left the local cache showing the change as applied, and a
 * failed read drew a period with nothing in it — indistinguishable from a
 * period where nothing was spent.
 *
 * Offline is deliberately NOT this: Firestore queues writes made without
 * signal and sends them later, so a write only lands here when the server
 * actually refused it. Reads do fail offline, which is why a failed read says
 * "could not read" rather than pretending the data is empty.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { onReadFailure } from "@/lib/firebase/read-failures";
import { useModalFocus } from "@/components/ui/use-modal-focus";

/**
 * What failed. A refused write and a refused read need different words: the
 * first says a change did not stick, the second that what is on screen may
 * be incomplete — and a write outranks a read, so a read failing a moment
 * later never covers the one that lost somebody's change.
 */
export type AppErrorKind = "write" | "read";

interface AppErrorContextValue {
  /** Surface a failure to the user. Safe to call with anything thrown. */
  report: (error: unknown, kind?: AppErrorKind) => void;
  /**
   * Run a fire-and-forget write and surface a rejection. Never awaited by the
   * caller: awaiting a write freezes the form until the server answers, which
   * is what the local cache exists to avoid.
   */
  write: (promise: Promise<unknown>) => void;
}

const AppErrorContext = createContext<AppErrorContextValue>({
  report: () => {},
  write: () => {},
});

export function useAppError(): AppErrorContextValue {
  return useContext(AppErrorContext);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * The mounted provider's reporter, for code that cannot use the hook.
 *
 * `Providers` renders this provider, so its own body sits ABOVE the context and
 * `useAppError()` is unavailable there — and that body is where the household,
 * the periods and the carryover are resolved, which is exactly where a failure
 * matters most. Falls back to the console when nothing is mounted (a test, or
 * a failure during the very first render).
 */
let mountedReport: ((error: unknown, kind?: AppErrorKind) => void) | null = null;

export function reportAppError(error: unknown, kind: AppErrorKind = "write"): void {
  if (mountedReport !== null) {
    mountedReport(error, kind);
    return;
  }
  console.error("[gastos]", error);
}

export function AppErrorProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ detail: string; kind: AppErrorKind } | null>(
    null,
  );

  const report = useCallback((error: unknown, kind: AppErrorKind = "write") => {
    // Kept in the console too: the dialog is for the person using the app, the
    // console is what a screenshot of the dev tools can still show later.
    console.error("[gastos]", error);
    setShown((prev) =>
      prev !== null && prev.kind === "write" && kind === "read"
        ? prev
        : { detail: describe(error), kind },
    );
  }, []);

  useEffect(() => {
    mountedReport = report;
    onReadFailure((error) => report(error, "read"));
    return () => {
      mountedReport = null;
      onReadFailure(null);
    };
  }, [report]);

  const write = useCallback(
    (promise: Promise<unknown>) => {
      void promise.catch((error: unknown) => report(error, "write"));
    },
    [report],
  );

  const value = useMemo(() => ({ report, write }), [report, write]);

  return (
    <AppErrorContext.Provider value={value}>
      {children}
      {shown !== null && (
        <AppErrorDialog
          detail={shown.detail}
          kind={shown.kind}
          onClose={() => setShown(null)}
        />
      )}
    </AppErrorContext.Provider>
  );
}

function AppErrorDialog({
  detail,
  kind,
  onClose,
}: {
  detail: string;
  kind: AppErrorKind;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>();
  const t = useTranslations("errors");
  const title = kind === "read" ? t("readTitle") : t("title");
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col gap-3.5 rounded-t-[24px] border border-line bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[24px]"
      >
        <div className="flex items-start gap-3">
          <Icon name="error" size={22} className="mt-0.5 text-over-text" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">{title}</h2>
            <p className="mt-1 text-[13px] text-ink-2">
              {kind === "read" ? t("readBody") : t("body")}
            </p>
            {/* The raw message. Ugly, and worth it: when this appears at all,
                a screenshot of it is the whole diagnosis. */}
            <p className="mt-2 break-words text-[11.5px] text-ink-3">
              {detail}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-fill px-4 py-2.5 text-[14px] font-bold text-ink"
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
