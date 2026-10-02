"use client";

// "Hacemos las cuentas": the day the household sat down, checked the numbers
// against the bank and settled up. One press records today; the last time is
// always on show beside it, and the history folds out underneath.
//
// Read once (Datos is visited, not lived in) and kept in local state after a
// press: the write is fired and not awaited, like every write here, so the
// screen moves the moment the press lands in the local cache.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useAppError } from "@/components/app-error";
import { Icon } from "@/components/ui/icon";
import { getFirebaseClient } from "@/lib/firebase/client";
import { fetchReckonings } from "@/lib/firebase/reckonings";
import { deleteReckoning, recordReckoning } from "@/lib/firebase/mutations";
import { formatLongDate, formatShortDateInYear } from "@/lib/dates";

type Entry = { date: string; createdBy: string };

export function Reckonings({
  householdId,
  uid,
  today,
  locale,
  memberName,
}: {
  householdId: string;
  uid: string;
  today: string;
  locale: string;
  memberName: (uid: string) => string;
}) {
  const t = useTranslations("data");
  const { write } = useAppError();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    fetchReckonings(fb.db, householdId)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((error: unknown) => {
        console.error("[gastos] reckonings read", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  const last = entries?.[0] ?? null;
  const doneToday = last?.date === today;

  const record = () => {
    const fb = getFirebaseClient();
    if (fb === null || entries === null || doneToday) return;
    write(recordReckoning(fb.db, householdId, uid, today));
    setEntries([{ date: today, createdBy: uid }, ...entries]);
  };

  const undo = () => {
    const fb = getFirebaseClient();
    if (fb === null || entries === null || !doneToday) return;
    write(deleteReckoning(fb.db, householdId, today));
    setEntries(entries.slice(1));
  };

  return (
    <div className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className="section-label">{t("reckoningTitle")}</span>
          <span className="text-[14px] font-bold text-ink">
            {failed
              ? t("reckoningFailed")
              : entries === null
                ? t("loading")
                : last === null
                  ? t("reckoningNever")
                  : t("reckoningLast", {
                      date: formatLongDate(last.date, locale),
                      who: memberName(last.createdBy),
                    })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {doneToday ? (
            <>
              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-good-text">
                <Icon name="check_circle" size={16} />
                {t("reckoningDoneToday")}
              </span>
              <button
                type="button"
                onClick={undo}
                className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:text-ink"
              >
                {t("reckoningUndo")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={record}
              disabled={entries === null}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-bold text-white primary-disabled"
            >
              <Icon name="fact_check" size={16} className="text-white" />
              {t("reckoningRecord")}
            </button>
          )}
        </div>
      </div>

      {entries !== null && entries.length > 0 && (
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex items-center gap-1 self-start text-[12px] font-semibold text-ink-3 hover:text-ink"
          >
            <Icon name={open ? "expand_less" : "expand_more"} size={16} />
            {t("reckoningHistory", { count: entries.length })}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col divide-y divide-soft">
              {entries.map((e) => (
                <li key={e.date} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                  <span className="font-semibold text-ink">
                    {formatShortDateInYear(e.date, today, locale)}
                  </span>
                  <span className="text-ink-3">{memberName(e.createdBy)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
