"use client";

// Onboarding (design 1g): login → create-or-join household → budget setup.
// Three progress dots; the active dot is a 20px-wide coral pill.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth, useLocale, ackNewPeriod } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { GoogleG, PiggyMark } from "@/components/brand";
import { AmountInput } from "@/components/ui/amount-input";
import { MAX_HOUSEHOLD_NAME_CHARACTERS } from "@/lib/limits";
import { Segmented } from "@/components/ui/segmented";
import { parseBudgetAmount } from "@/components/budget-amount-field";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  completeRedirectSignIn,
  signInWithGoogle,
} from "@/lib/firebase/sign-in";
import {
  createHousehold,
  joinHousehold,
  DEFAULT_TIMEZONE,
} from "@/lib/firebase/mutations";
import { formatLongDate } from "@/lib/dates";
import { todayInTimezone, type PeriodType } from "@/lib/periods";

function Dots({ active }: { active: 0 | 1 | 2 }) {
  return (
    <div className="flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[7px] rounded-full"
          style={{
            width: i === active ? 20 : 7,
            background: i === active ? "var(--accent)" : "var(--track)",
          }}
        />
      ))}
    </div>
  );
}

function GoogleMark() {
  return <GoogleG size={22} />;
}

function LoginStep() {
  const t = useTranslations();
  const [error, setError] = useState(false);
  // True from the moment a redirect is kicked off until the page unloads, so
  // the button can't be hit twice while Safari is navigating away.
  const [busy, setBusy] = useState(false);

  // Surface a failed redirect sign-in on the way back from Google; a
  // successful one is picked up by onAuthStateChanged.
  useEffect(() => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    void completeRedirectSignIn(fb.auth).catch(() => setError(true));
  }, []);

  const signIn = async () => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    setError(false);
    setBusy(true);
    try {
      // Popup in a browser tab, redirect in an installed PWA — see sign-in.ts.
      await signInWithGoogle(fb.auth, fb.googleProvider);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-[380px] flex-col items-center">
      <div className="mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-[28px] bg-accent shadow-[0_12px_28px_rgba(255,92,57,.35)]">
        <PiggyMark size={64} variant="cream" />
      </div>
      {/* From the messages, like the sidebar. Typed in, this was the last
          place the old two-word name survived: it was split across a `<br />`,
          so searching for it as one string found nothing. See
          lib/ios-config.test.ts, which now looks for the split spelling. */}
      <h1 className="text-center text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
        {t("app.name")}
      </h1>
      <p className="mb-12 mt-3.5 text-center text-[15px] leading-[1.45] text-ink-2">
        {t.rich("app.tagline", { br: () => <br /> })}
      </p>
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={busy}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full border border-pill bg-surface shadow-[0_2px_8px_rgba(36,26,16,.06)] disabled:opacity-60"
      >
        <GoogleMark />
        <span className="text-[15.5px] font-bold text-ink">
          {t("auth.continueWithGoogle")}
        </span>
      </button>
      {error && (
        <p className="mt-4 text-sm font-semibold text-over">
          {t("auth.signInError")}
        </p>
      )}
      <div className="mt-10">
        <Dots active={0} />
      </div>
    </div>
  );
}

function ChooseStep({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("onboarding");
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(false);
  const firstName = (user?.displayName ?? "").split(" ")[0] || "—";

  const join = async () => {
    const fb = getFirebaseClient();
    if (fb === null || user === null || code.trim() === "") return;
    setJoining(true);
    setError(false);
    try {
      await joinHousehold(fb.db, user.uid, user.displayName ?? "", code);
      // The user-doc snapshot flips householdId and the shell moves on.
    } catch {
      setError(true);
      setJoining(false);
    }
  };

  return (
    <div className="flex w-full max-w-[440px] flex-col">
      <h1 className="mb-2 text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
        {t("greeting", { name: firstName })}
        <br />
        {t("setupQuestion")}
      </h1>
      <p className="mb-7 text-[14.5px] leading-[1.45] text-ink-2">
        {t("setupHint")}
      </p>

      <button
        type="button"
        onClick={onCreate}
        className="mb-3 flex items-center gap-3.5 rounded-[22px] border-2 border-accent bg-surface p-[18px] text-left shadow-[0_6px_18px_rgba(255,92,57,.15)]"
      >
        <div className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-2xl bg-accent-soft">
          <Icon name="home" size={23} className="text-accent" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-base font-bold text-ink">
            {t("createTitle")}
          </span>
          <span className="text-[12.5px] text-ink-2">{t("createHint")}</span>
        </div>
        <Icon name="arrow_forward" size={20} className="text-accent" />
      </button>

      <div className="flex flex-col gap-3 rounded-[22px] border border-pill bg-surface p-[18px]">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-2xl"
            style={{ background: "rgba(42,111,219,.12)" }}
          >
            <Icon name="key" size={23} style={{ color: "var(--member-blue)" }} />
          </div>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-base font-bold text-ink">
              {t("joinTitle")}
            </span>
            <span className="text-[12.5px] text-ink-2">{t("joinHint")}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("codePlaceholder")}
            className="min-w-0 flex-1 rounded-xl border border-pill bg-bg px-3.5 py-3 text-[15px] font-semibold tracking-[.1em] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={() => void join()}
            disabled={joining || code.trim() === ""}
            className="rounded-xl bg-ink px-[18px] text-[13.5px] font-bold text-bg disabled:opacity-50"
          >
            {joining ? t("joining") : t("join")}
          </button>
        </div>
        {error && (
          <p className="text-sm font-semibold text-over">{t("joinError")}</p>
        )}
      </div>

      <div className="mt-12 self-center">
        <Dots active={1} />
      </div>
    </div>
  );
}

function BudgetStep({ onBack }: { onBack: () => void }) {
  const t = useTranslations("onboarding");
  const tp = useTranslations("period");
  const { user } = useAuth();
  const { locale } = useLocale();
  const firstName = (user?.displayName ?? "").split(" ")[0] || "—";

  const [name, setName] = useState(() =>
    t("defaultHouseholdName", { name: firstName }),
  );
  const [amount, setAmount] = useState("900");
  const [period, setPeriod] = useState<PeriodType>("fortnightly");
  const [startDate, setStartDate] = useState(() =>
    todayInTimezone(new Date(), DEFAULT_TIMEZONE),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);

  const cents = parseBudgetAmount(amount, locale);
  const valid = cents !== null && name.trim() !== "" && startDate !== "";

  const create = async () => {
    const fb = getFirebaseClient();
    if (fb === null || user === null || cents === null) return;
    setCreating(true);
    setError(false);
    try {
      const householdId = await createHousehold(
        fb.db,
        user.uid,
        user.displayName ?? "",
        name.trim(),
        cents,
        period,
        startDate,
      );
      // The budget was just chosen — don't pop the new-period sheet for it.
      ackNewPeriod(householdId, startDate);
    } catch {
      setError(true);
      setCreating(false);
    }
  };

  return (
    <div className="flex w-full max-w-[440px] flex-col">
      <h1 className="mb-2 text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
        {t("budgetTitle")}
      </h1>
      <p className="mb-7 text-[14.5px] leading-[1.45] text-ink-2">
        {t("budgetHint")}
      </p>

      <div className="flex flex-col gap-[18px] rounded-[22px] border border-pill bg-surface px-[18px] py-[22px]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_HOUSEHOLD_NAME_CHARACTERS}
          aria-label={t("householdName")}
          className="rounded-xl border border-pill bg-bg px-3.5 py-3 text-[15px] font-semibold text-ink outline-none"
        />
        <div className="flex flex-col gap-2.5">
          <AmountInput value={amount} onChange={setAmount} />
        </div>
        <Segmented
          options={[
            { value: "weekly", label: tp("weekly") },
            { value: "fortnightly", label: tp("fortnightly") },
          ]}
          value={period}
          onChange={setPeriod}
          size="lg"
          stretch
        />
        <div className="flex items-center justify-between rounded-[14px] bg-bg px-4 py-[13px]">
          <span className="text-sm font-semibold text-ink">{t("starts")}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-2">
              {formatLongDate(startDate, locale)}
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                if (e.target.value !== "") setStartDate(e.target.value);
              }}
              className="w-[26px] cursor-pointer border-none bg-transparent text-transparent outline-none"
              aria-label={t("starts")}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm font-semibold text-over">
          {t("createError")}
        </p>
      )}

      <div className="mt-12 flex flex-col items-center gap-6">
        <button
          type="button"
          onClick={() => void create()}
          disabled={!valid || creating}
          className="h-14 w-full rounded-full bg-accent text-base font-bold text-white shadow-[0_8px_20px_rgba(255,92,57,.35)] disabled:opacity-60"
        >
          {creating ? t("creating") : t("finish")}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-ink-2"
        >
          {t("back")}
        </button>
        <Dots active={2} />
      </div>
    </div>
  );
}

export function Onboarding({ stage }: { stage: "login" | "household" }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-8 py-16">
      {stage === "login" ? (
        <LoginStep />
      ) : creating ? (
        <BudgetStep onBack={() => setCreating(false)} />
      ) : (
        <ChooseStep onCreate={() => setCreating(true)} />
      )}
    </div>
  );
}
