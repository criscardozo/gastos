"use client";

// Ajustes (design 4c): default budget vs current period, preferences
// (USD display toggle, language), household + invite code, sign out.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "firebase/auth";

import {
  useAuth,
  useHousehold,
  useLocale,
  useUserDoc,
  type Locale,
} from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { AvatarPair } from "@/components/ui/avatar";
import { Segmented } from "@/components/ui/segmented";
import {
  BudgetCurrencyControls,
  entryToAudCents,
  useBudgetCurrency,
} from "@/components/budget-amount-field";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  createInvite,
  updateDefaultBudget,
  updatePeriodAmount,
  updateUserDisplayCurrency,
  updateUserLanguage,
} from "@/lib/firebase/mutations";
import { formatCents } from "@/lib/money";
import { formatPeriodRange } from "@/lib/dates";
import type { PeriodType } from "@/lib/periods";

/* Amount that flips into a small inline editor on click. */
function EditableAmount({
  cents,
  currency,
  locale,
  bold,
  onSave,
}: {
  cents: number;
  currency: string;
  locale: string;
  bold?: boolean;
  onSave: (cents: number) => void;
}) {
  const t = useTranslations("settings");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const {
    currency: entryCurrency,
    setCurrency: setEntryCurrency,
    usdRate,
  } = useBudgetCurrency();

  const commit = () => {
    const parsed = entryToAudCents(value, entryCurrency, usdRate);
    if (parsed !== null && parsed !== cents) onSave(parsed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex flex-col items-end gap-1.5"
        onBlur={(e) => {
          // Commit only when focus leaves the whole editor (input + toggle).
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            commit();
          }
        }}
      >
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="tnum w-28 rounded-[10px] border border-pill bg-bg px-2.5 py-1 text-right text-sm font-semibold text-ink outline-none"
          aria-label={t("editAmount")}
        />
        {/* preventDefault keeps the input focused while clicking the toggle
            (Safari does not focus buttons on click, so relatedTarget alone
            would commit-and-close before the click lands). */}
        <div onMouseDown={(e) => e.preventDefault()}>
          <BudgetCurrencyControls
            amount={value}
            currency={entryCurrency}
            onCurrencyChange={setEntryCurrency}
            usdRate={usdRate}
            locale={locale}
            align="end"
          />
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(
          (cents / 100).toLocaleString(locale === "es" ? "es-AR" : "en-AU", {
            minimumFractionDigits: 2,
            useGrouping: false,
          }),
        );
        setEntryCurrency("AUD");
        setEditing(true);
      }}
      className={`tnum text-sm ${
        bold ? "font-bold text-ink" : "font-semibold text-ink-2"
      } underline-offset-4 hover:underline`}
      title={t("editAmount")}
    >
      {formatCents(cents, currency, locale)}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative h-[26px] w-11 flex-none rounded-full transition-colors"
      style={{ background: checked ? "var(--good)" : "var(--track)" }}
    >
      <span
        className="absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-all"
        style={{ left: checked ? 20 : 2 }}
      />
    </button>
  );
}

function inviteCodeKey(householdId: string): string {
  return `gd:inviteCode:${householdId}`;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tp = useTranslations("period");
  const tAuth = useTranslations("auth");
  const { locale, setLocale } = useLocale();
  const { user } = useAuth();
  const { userDoc } = useUserDoc();
  const { household, currentPeriod } = useHousehold();

  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const householdFull = (household?.memberIds.length ?? 0) >= 2;
  const householdId = household?.id ?? null;
  const uid = user?.uid ?? null;

  // Invites can't be listed (rules), so the creator's code is remembered in
  // localStorage; if lost, a fresh invite doc is minted.
  useEffect(() => {
    if (householdId === null || uid === null || householdFull) return;
    const stored = localStorage.getItem(inviteCodeKey(householdId));
    if (stored !== null) {
      setInviteCode(stored);
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    void createInvite(fb.db, uid, householdId)
      .then((code) => {
        if (cancelled) return;
        localStorage.setItem(inviteCodeKey(householdId), code);
        setInviteCode(code);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [householdId, uid, householdFull]);

  if (household === null || user === null) return null;

  const members = household.memberIds
    .map((id) => household.memberProfiles[id])
    .filter((p) => p !== undefined)
    .map((p) => ({ name: p.displayName, color: p.color }));

  const withDb = (fn: (db: NonNullable<ReturnType<typeof getFirebaseClient>>["db"]) => Promise<void>) => {
    const fb = getFirebaseClient();
    if (fb !== null) void fn(fb.db);
  };

  const copyCode = async () => {
    if (inviteCode === null) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code is visible to copy by hand.
    }
  };

  return (
    <div className="mx-auto flex w-[660px] max-w-full flex-col gap-3.5">
      <h1 className="mb-1 text-[22px] font-bold text-ink">{t("title")}</h1>

      {/* Default budget + this period — stacked below lg (iPad portrait) */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
          <span className="section-label">{t("defaultBudget")}</span>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">
              {t("amount")}
            </span>
            <div className="flex items-center gap-1">
              <EditableAmount
                cents={household.defaultBudget.amountCents}
                currency={household.currency}
                locale={locale}
                onSave={(cents) =>
                  withDb((db) =>
                    updateDefaultBudget(db, household.id, {
                      amountCents: cents,
                    }),
                  )
                }
              />
              <span className="text-sm font-semibold text-ink-2">
                {household.currency}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">
              {t("periodType")}
            </span>
            <Segmented<PeriodType>
              options={[
                { value: "weekly", label: tp("weekly") },
                { value: "fortnightly", label: tp("fortnightly") },
              ]}
              value={household.defaultBudget.period}
              onChange={(period) =>
                withDb((db) =>
                  updateDefaultBudget(db, household.id, { period }),
                )
              }
            />
          </div>
        </div>

        {currentPeriod !== null && (
          <div
            className="flex flex-col gap-2.5 rounded-[18px] bg-surface px-[18px] py-4"
            style={{ border: "1.5px solid rgba(255,92,57,.5)" }}
          >
            <span className="section-label">
              {t("thisPeriod", {
                range: formatPeriodRange(
                  currentPeriod.startDate,
                  currentPeriod.endDate,
                  locale,
                  "short",
                ),
              })}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">
                {t("budget")}
              </span>
              <div className="flex items-center gap-2">
                <EditableAmount
                  cents={currentPeriod.amountCents}
                  currency={household.currency}
                  locale={locale}
                  bold
                  onSave={(cents) =>
                    withDb((db) =>
                      updatePeriodAmount(
                        db,
                        household.id,
                        currentPeriod.startDate,
                        cents,
                      ),
                    )
                  }
                />
                {currentPeriod.source === "custom" && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold text-accent-strong">
                    {tp("adjusted")}
                  </span>
                )}
              </div>
            </div>
            <span className="text-xs leading-[1.4] text-ink-3">
              {t("thisPeriodNote")}
            </span>
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="rounded-[18px] border border-line bg-surface px-[18px] py-1.5">
        <div className="flex items-center gap-[11px] border-b border-soft py-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-ink">
              {t("showUsd")}
            </span>
            <span className="text-xs text-ink-3">{t("showUsdHint")}</span>
          </div>
          <Toggle
            checked={userDoc?.displayCurrency === "USD"}
            ariaLabel={t("showUsd")}
            onChange={(next) =>
              withDb((db) =>
                updateUserDisplayCurrency(db, user.uid, next ? "USD" : null),
              )
            }
          />
        </div>
        <div className="flex items-center gap-[11px] py-3">
          <span className="flex-1 text-sm font-semibold text-ink">
            {t("language")}
          </span>
          <Segmented<Locale>
            options={[
              { value: "es", label: t("spanish") },
              { value: "en", label: t("english") },
            ]}
            value={locale}
            onChange={(next) => {
              setLocale(next);
              withDb((db) => updateUserLanguage(db, user.uid, next));
            }}
          />
        </div>
      </div>

      {/* Household + invite */}
      <div className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
        <AvatarPair members={members} size={30} />
        <span className="flex-1 truncate text-sm font-semibold text-ink">
          {household.name}
        </span>
        {!householdFull && inviteCode !== null && (
          <div
            className="flex items-center gap-2.5 rounded-xl px-3 py-2"
            style={{ border: "1.5px dashed color-mix(in srgb, var(--ink) 20%, transparent)" }}
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[.05em] text-ink-3">
                {t("inviteCode")}
              </span>
              <span className="text-[13.5px] font-bold tracking-[.1em] text-ink">
                {inviteCode}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void copyCode()}
              className="flex items-center gap-[5px] rounded-full bg-ink px-3 py-1.5"
            >
              <Icon name="content_copy" size={14} className="text-bg" />
              <span className="text-xs font-bold text-bg">
                {copied ? t("copied") : t("copy")}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={() => {
          const fb = getFirebaseClient();
          if (fb !== null) void signOut(fb.auth);
        }}
        className="flex items-center gap-2.5 rounded-[18px] border border-line bg-surface px-[18px] py-3.5 text-left"
      >
        <Icon name="logout" size={18} style={{ color: "var(--over)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--over)" }}>
          {tAuth("signOut")}
        </span>
      </button>
    </div>
  );
}
