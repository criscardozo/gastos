"use client";

// Datos (Data): export the household's expenses (CSV / PDF) over a chosen
// range, and import expenses from a CSV that matches the app's export format.
//
// Reads are one-shot and date-bounded (getDocs, not a live listener — export
// is an action, not a subscription). Imports write via a chunked writeBatch
// matching the exact expense field set the security rules validate.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { getFirebaseClient } from "@/lib/firebase/client";
import { expenseConverter, type Expense } from "@/lib/firebase/converters";
import { formatApproxUsd, formatCents, parseAmountToCents } from "@/lib/money";
import { formatPeriodRange } from "@/lib/dates";
import { addDays, type PeriodRange } from "@/lib/periods";
import { buildExpensesCsv, downloadCsv, parseCsv } from "@/lib/export/csv";
import { exportExpensesPdf } from "@/lib/export/pdf";

/* ── Pure helpers ──────────────────────────────────────────────────────── */

type RangePreset = "week" | "current" | "previous" | "custom";

/** Case- and diacritic-insensitive fold for category/header matching. */
function fold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** True for a well-formed AND real "YYYY-MM-DD" calendar date. */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Monday–Sunday week containing `today` (already a household-tz date). */
function weekRange(today: string): PeriodRange {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  const start = addDays(today, -backToMonday);
  return { startDate: start, endDate: addDays(start, 6) };
}

interface PreviewRow {
  rawDate: string;
  rawCategory: string;
  note: string;
  rawAmount: string;
  date: string;
  categoryId: string;
  amountCents: number | null;
  /** Entry currency parsed from the optional `moneda` column (default AUD). */
  entryCurrency: "AUD" | "USD";
  /** Original amount in `entryCurrency` (integer cents) — only set for USD. */
  entryAmountCents: number | null;
  status: "ok" | "mapped" | "error";
  reasonKey?: "reasonBadDate" | "reasonBadAmount" | "reasonBadCurrency";
}

// Amount cap mirrors the security rule (1..10_000_000 cents).
const MAX_AMOUNT_CENTS = 10_000_000;
const MAX_NOTE_LEN = 200;
const BATCH_CHUNK = 400;

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function DataPage() {
  const t = useTranslations("data");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { household, periods, currentPeriod, today } = useHousehold();

  const [preset, setPreset] = useState<RangePreset>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loadState, setLoadState] = useState<{
    rows: Expense[];
    loading: boolean;
  }>({ rows: [], loading: false });

  // Import state.
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [headerError, setHeaderError] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [importPhase, setImportPhase] = useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* Localized category list + lookup maps (must be before any early return
     since hooks can't be conditional). */
  const categories = useMemo(() => {
    if (household === null) return [] as { id: string; label: string }[];
    return Object.entries(household.categories)
      .map(([id, def]) => ({
        id,
        label: def.key !== undefined ? tCat(def.key) : (def.name ?? id),
        sortOrder: def.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id, label }) => ({ id, label }));
  }, [household, tCat]);

  const catLabelOf = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.label]));
    return (id: string): string => map.get(id) ?? tCat("deleted");
  }, [categories, tCat]);

  // Fold map: both localized labels and ids resolve to an id (ids win).
  const matchCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(fold(c.label), c.id);
    for (const c of categories) map.set(fold(c.id), c.id);
    return (value: string): string | null => map.get(fold(value)) ?? null;
  }, [categories]);

  const memberNames = useMemo(() => {
    if (household === null) return {} as Record<string, string>;
    return Object.fromEntries(
      Object.entries(household.memberProfiles).map(([uid, p]) => [
        uid,
        p.displayName,
      ]),
    );
  }, [household]);

  /* Resolve the [from, to] range for the current preset. */
  const range = useMemo<PeriodRange | null>(() => {
    if (preset === "week") return today !== null ? weekRange(today) : null;
    if (preset === "custom") {
      if (customFrom === "" || customTo === "" || customFrom > customTo) {
        return null;
      }
      return { startDate: customFrom, endDate: customTo };
    }
    const currentIdx = currentPeriod
      ? periods.findIndex((p) => p.startDate === currentPeriod.startDate)
      : periods.length - 1;
    if (preset === "current") {
      const p = currentPeriod ?? periods[periods.length - 1] ?? null;
      return p ? { startDate: p.startDate, endDate: p.endDate } : null;
    }
    // previous
    const prev = periods[currentIdx - 1] ?? null;
    return prev ? { startDate: prev.startDate, endDate: prev.endDate } : null;
  }, [preset, today, customFrom, customTo, currentPeriod, periods]);

  /* One-shot bounded read for the resolved range. */
  const householdId = household?.id ?? null;
  const rangeFrom = range?.startDate ?? null;
  const rangeTo = range?.endDate ?? null;
  useEffect(() => {
    if (householdId === null || rangeFrom === null || rangeTo === null) {
      setLoadState({ rows: [], loading: false });
      return;
    }
    const fb = getFirebaseClient();
    if (fb === null) return;
    let cancelled = false;
    setLoadState({ rows: [], loading: true });
    const q = query(
      collection(fb.db, "households", householdId, "expenses"),
      where("date", ">=", rangeFrom),
      where("date", "<=", rangeTo),
      orderBy("date", "asc"),
    ).withConverter(expenseConverter);
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        setLoadState({ rows: snap.docs.map((d) => d.data()), loading: false });
      })
      .catch(() => {
        if (!cancelled) setLoadState({ rows: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, rangeFrom, rangeTo]);

  if (household === null || user === null) return null;

  const rows = loadState.rows;
  const total = rows.reduce((sum, e) => sum + e.amountCents, 0);
  const canExport = !loadState.loading && rows.length > 0 && range !== null;
  const fileBase =
    range !== null ? `gastos-${range.startDate}_${range.endDate}` : "gastos";

  const changePreset = (next: RangePreset) => {
    if (next === "custom" && customFrom === "") {
      const seed =
        currentPeriod ?? (today !== null ? weekRange(today) : null);
      if (seed !== null) {
        setCustomFrom(seed.startDate);
        setCustomTo(seed.endDate);
      }
    }
    setPreset(next);
  };

  /* ── Export ──────────────────────────────────────────────────────────── */

  const exportCsv = () => {
    const csv = buildExpensesCsv(rows, {
      categories,
      members: memberNames,
      deletedLabel: tCat("deleted"),
    });
    downloadCsv(`${fileBase}.csv`, csv);
  };

  const exportPdf = async () => {
    if (range === null) return;
    const totalsMap = new Map<string, number>();
    for (const e of rows) {
      totalsMap.set(e.categoryId, (totalsMap.get(e.categoryId) ?? 0) + e.amountCents);
    }
    const categoryTotals = [...totalsMap.entries()]
      .map(([id, amountCents]) => ({ label: catLabelOf(id), amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);
    await exportExpensesPdf({
      filename: `${fileBase}.pdf`,
      title: "Gastos Diarios",
      householdName: household.name,
      rangeLabel: `${formatPeriodRange(range.startDate, range.endDate, locale, "short")} ${range.endDate.slice(0, 4)}`,
      rows: rows.map((e) => ({
        date: e.date,
        categoryLabel: catLabelOf(e.categoryId),
        note: e.note,
        memberLabel: memberNames[e.createdBy] ?? e.createdBy,
        amountCents: e.amountCents,
      })),
      categoryTotals,
      grandTotalCents: total,
      currency: household.currency,
      locale,
      labels: {
        date: t("colDate"),
        category: t("colCategory"),
        note: t("colNote"),
        person: t("colPerson"),
        amount: t("colAmount"),
        byCategory: t("byCategory"),
        total: t("total"),
        countLine: t("expensesCount", { count: rows.length }),
      },
    });
  };

  /* ── Import ──────────────────────────────────────────────────────────── */

  const buildPreview = (grid: string[][]): PreviewRow[] | null => {
    // Drop fully-empty rows (blank lines).
    const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ""));
    if (nonEmpty.length === 0) return null;
    const header = nonEmpty[0];
    // `moneda` + `monto_original` are optional: files exported before the
    // bi-currency feature (or edited by hand) still import as AUD.
    const idx = {
      date: -1,
      category: -1,
      note: -1,
      amount: -1,
      currency: -1,
      original: -1,
    };
    header.forEach((cell, i) => {
      const f = fold(cell);
      if (f === "fecha") idx.date = i;
      else if (f === "categoria") idx.category = i;
      else if (f === "nota") idx.note = i;
      else if (f === "monto_aud") idx.amount = i;
      else if (f === "moneda") idx.currency = i;
      else if (f === "monto_original") idx.original = i;
    });
    if (idx.date < 0 || idx.category < 0 || idx.amount < 0) return null;

    const out: PreviewRow[] = [];
    for (const cells of nonEmpty.slice(1)) {
      const rawDate = (cells[idx.date] ?? "").trim();
      const rawCategory = (cells[idx.category] ?? "").trim();
      const rawAmount = (cells[idx.amount] ?? "").trim();
      const rawCurrency = (idx.currency >= 0 ? (cells[idx.currency] ?? "") : "")
        .trim();
      const rawOriginal = (idx.original >= 0 ? (cells[idx.original] ?? "") : "")
        .trim();
      const note = (idx.note >= 0 ? (cells[idx.note] ?? "") : "")
        .trim()
        .slice(0, MAX_NOTE_LEN);

      const dateOk = isRealDate(rawDate);
      // monto_aud is always the canonical AUD (do NOT re-convert on import —
      // the CSV carries both figures already).
      const parsed = parseAmountToCents(rawAmount);
      const amountOk = parsed !== null && parsed <= MAX_AMOUNT_CENTS;

      // Currency: absent/empty ⇒ AUD; only AUD/USD are valid.
      const folded = fold(rawCurrency);
      const currency: "AUD" | "USD" | null =
        folded === "" || folded === "aud"
          ? "AUD"
          : folded === "usd"
            ? "USD"
            : null;

      // For USD, the entered original must itself be a valid positive amount.
      const parsedOriginal =
        currency === "USD" ? parseAmountToCents(rawOriginal) : null;
      const originalOk =
        currency !== "USD" ||
        (parsedOriginal !== null && parsedOriginal <= MAX_AMOUNT_CENTS);

      const matched = matchCategory(rawCategory);
      const categoryId = matched ?? "other";

      let status: PreviewRow["status"];
      let reasonKey: PreviewRow["reasonKey"];
      if (!dateOk) {
        status = "error";
        reasonKey = "reasonBadDate";
      } else if (currency === null) {
        status = "error";
        reasonKey = "reasonBadCurrency";
      } else if (!amountOk || !originalOk) {
        status = "error";
        reasonKey = "reasonBadAmount";
      } else if (matched === null) {
        status = "mapped";
      } else {
        status = "ok";
      }

      out.push({
        rawDate,
        rawCategory,
        note,
        rawAmount,
        date: rawDate,
        categoryId,
        amountCents: amountOk ? parsed : null,
        entryCurrency: currency ?? "AUD",
        entryAmountCents: currency === "USD" ? parsedOriginal : null,
        status,
        reasonKey,
      });
    }
    return out;
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setImportPhase("idle");
    setImportedCount(0);
    setFileError(false);
    setHeaderError(false);
    setPreview(null);
    try {
      const text = await file.text();
      const grid = parseCsv(text);
      const built = buildPreview(grid);
      if (built === null) {
        setHeaderError(true);
        return;
      }
      setPreview(built);
    } catch {
      setFileError(true);
    }
  };

  const importable = preview?.filter((r) => r.status !== "error") ?? [];
  const errorCount = (preview?.length ?? 0) - importable.length;

  const doImport = async () => {
    const fb = getFirebaseClient();
    if (fb === null || importable.length === 0) return;
    setImportPhase("working");
    try {
      for (let i = 0; i < importable.length; i += BATCH_CHUNK) {
        const batch = writeBatch(fb.db);
        for (const r of importable.slice(i, i + BATCH_CHUNK)) {
          const ref = doc(
            collection(fb.db, "households", household.id, "expenses"),
          );
          // USD rows carry the entered original alongside the canonical AUD;
          // AUD rows omit the keys entirely so the doc shape stays identical to
          // the pre-bi-currency shape the rules' hasOnly() check expects.
          const entry =
            r.entryCurrency === "USD" && r.entryAmountCents !== null
              ? {
                  entryCurrency: "USD" as const,
                  entryAmountCents: r.entryAmountCents,
                }
              : null;
          batch.set(ref, {
            amountCents: r.amountCents as number,
            categoryId: r.categoryId,
            note: r.note,
            date: r.date,
            createdBy: user.uid,
            ...(entry ?? {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      setImportedCount(importable.length);
      setImportPhase("done");
      setPreview(null);
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    } catch {
      setImportPhase("error");
    }
  };

  const statusBadge = (r: PreviewRow) => {
    const styles: Record<PreviewRow["status"], string> = {
      ok: "bg-good-bg text-good-text",
      mapped: "bg-warn-bg text-warn-text",
      error: "bg-over-bg text-over",
    };
    const label =
      r.status === "ok"
        ? t("statusOk")
        : r.status === "mapped"
          ? t("statusMapped")
          : `${t("statusError")}: ${r.reasonKey ? t(r.reasonKey) : ""}`;
    return (
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${styles[r.status]}`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="mx-auto flex w-[720px] max-w-full flex-col gap-3.5">
      <div className="mb-1 flex flex-col gap-0.5">
        <h1 className="text-[22px] font-bold text-ink">{t("title")}</h1>
        <p className="text-[13px] text-ink-3">{t("subtitle")}</p>
      </div>

      {/* ── Export card ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent-soft">
            <Icon name="download" size={17} className="text-accent-strong" />
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-bold text-ink">
              {t("exportTitle")}
            </span>
            <span className="text-xs text-ink-3">{t("exportHint")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="section-label">{t("rangeLabel")}</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented<RangePreset>
              ariaLabel={t("rangeLabel")}
              options={[
                { value: "week", label: t("rangeWeek") },
                { value: "current", label: t("rangeCurrent") },
                { value: "previous", label: t("rangePrevious") },
                { value: "custom", label: t("rangeCustom") },
              ]}
              value={preset}
              onChange={changePreset}
            />
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                {t("from")}
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label={t("from")}
                  className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13.5px] font-semibold text-ink outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                {t("to")}
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label={t("to")}
                  className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13.5px] font-semibold text-ink outline-none"
                />
              </label>
            </div>
          )}
        </div>

        {/* Summary + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-soft pt-3.5">
          <span className="tnum text-[13px] font-semibold text-ink-2">
            {loadState.loading
              ? t("loading")
              : rows.length === 0
                ? t("exportEmpty")
                : t("summary", {
                    count: rows.length,
                    total: formatCents(total, household.currency, locale),
                  })}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!canExport}
              className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
            >
              <Icon name="download" size={15} className="text-white" />
              {t("exportCsv")}
            </button>
            <button
              type="button"
              onClick={() => void exportPdf()}
              disabled={!canExport}
              className="flex items-center gap-1.5 rounded-full border border-pill bg-surface px-4 py-2 text-[13px] font-bold text-ink disabled:opacity-40"
            >
              <Icon name="download" size={15} className="text-ink-2" />
              {t("exportPdf")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Import card ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent-soft">
            <Icon name="database" size={17} className="text-accent-strong" />
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-bold text-ink">
              {t("importTitle")}
            </span>
            <span className="text-xs text-ink-3">{t("importHint")}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e)}
            aria-label={t("chooseFile")}
            className="block max-w-full text-[13px] text-ink-2 file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-pill file:bg-fill file:px-4 file:py-2 file:text-[13px] file:font-bold file:text-ink"
          />
        </div>

        {fileError && (
          <p className="text-[13px] font-semibold text-over">{t("fileError")}</p>
        )}
        {headerError && (
          <p className="text-[13px] font-semibold text-over">
            {t("reasonNoColumns")}
          </p>
        )}

        {preview !== null && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="section-label">{t("preview")}</span>
              <span className="text-[13px] font-semibold text-ink-2">
                {t("previewSummary", {
                  importable: importable.length,
                  errors: errorCount,
                })}
              </span>
            </div>

            {/* Dedup warning */}
            <div className="flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2.5">
              <Icon
                name="flag"
                size={15}
                style={{ color: "var(--warn-text)" }}
                className="mt-0.5 flex-none"
              />
              <span className="text-xs font-semibold text-warn-text">
                {t("dedupeWarning")}
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-soft text-ink-3">
                    <th className="px-3 py-2 font-semibold">{t("colDate")}</th>
                    <th className="px-3 py-2 font-semibold">
                      {t("colCategory")}
                    </th>
                    <th className="px-3 py-2 font-semibold">{t("colNote")}</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      {t("colAmount")}
                    </th>
                    <th className="px-3 py-2 font-semibold">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-soft">
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td className="tnum px-3 py-2 text-ink">{r.rawDate}</td>
                      <td className="px-3 py-2 text-ink">
                        {r.status === "mapped"
                          ? `${r.rawCategory || "—"} → ${catLabelOf("other")}`
                          : r.rawCategory || "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">
                        {r.note || "—"}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-semibold text-ink">
                        {r.amountCents !== null ? (
                          r.entryCurrency === "USD" &&
                          r.entryAmountCents !== null ? (
                            <div className="flex flex-col items-end leading-tight">
                              <span>
                                {formatCents(
                                  r.amountCents,
                                  household.currency,
                                  locale,
                                )}
                              </span>
                              <span className="text-[11px] font-semibold text-ink-3">
                                {formatApproxUsd(r.entryAmountCents, locale)}
                              </span>
                            </div>
                          ) : (
                            formatCents(r.amountCents, household.currency, locale)
                          )
                        ) : (
                          r.rawAmount || "—"
                        )}
                      </td>
                      <td className="px-3 py-2">{statusBadge(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] font-semibold">
                {importPhase === "done" && (
                  <span className="text-good-text">
                    {t("importDone", { count: importedCount })}
                  </span>
                )}
                {importPhase === "error" && (
                  <span className="text-over">{t("importError")}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void doImport()}
                disabled={importable.length === 0 || importPhase === "working"}
                className="rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {importPhase === "working"
                  ? t("importing")
                  : t("importButton", { count: importable.length })}
              </button>
            </div>
          </div>
        )}

        {preview === null && importPhase === "done" && (
          <p className="text-[13px] font-semibold text-good-text">
            {t("importDone", { count: importedCount })}
          </p>
        )}
      </div>
    </div>
  );
}
