"use client";

// Datos (Data): the household's expenses for a range, on screen, exactly as an
// export would render them — same columns, same order, same totals.
//
// The grid IS the page. Exporting used to be the page, which meant the only way
// to find out what a file would contain was to open it; now the file is
// whatever is on screen, filtered and sorted, and the buttons are a footnote.
// Importing moved to Ajustes: it is a rare, one-way write that had no business
// sitting next to four read-only buttons.
//
// Reads are one-shot and date-bounded (getDocs, not a live listener — this is a
// page you visit, not one you live in).

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { getFirebaseClient } from "@/lib/firebase/client";
import { expenseConverter, type Expense } from "@/lib/firebase/converters";
import { formatCents, formatUsd } from "@/lib/money";
import { formatPeriodRange, formatShortDate } from "@/lib/dates";
import { addDays, type PeriodRange } from "@/lib/periods";
import { buildExpensesCsv, downloadCsv } from "@/lib/export/csv";
import { exportExpensesPdf, type PdfExportOptions } from "@/lib/export/pdf";
import {
  buildExpensesWorkbook,
  downloadWorkbook,
} from "@/lib/export/spreadsheet";
import { DriveExportError, exportToGoogleDrive } from "@/lib/export/drive";

/* ── Pure helpers ──────────────────────────────────────────────────────── */

type RangePreset = "week" | "current" | "previous" | "custom";

/** Monday–Sunday week containing `today` (already a household-tz date). */
function weekRange(today: string): PeriodRange {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  const start = addDays(today, -backToMonday);
  return { startDate: start, endDate: addDays(start, 6) };
}

/** Which column the grid is ordered by. */
type SortKey = "date" | "category" | "note" | "person" | "amount" | "amountUsd";

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
  /** Category ids to include in the export; null = all of them. */
  const [exportCategories, setExportCategories] = useState<string[] | null>(
    null,
  );
  const [exportPhase, setExportPhase] = useState<
    "idle" | "excel" | "drive" | "error" | "driveStandalone"
  >("idle");
  /** Ticked consent to export a range that still has unverified expenses. */
  const [acceptUnverified, setAcceptUnverified] = useState(false);
  /** How the grid is ordered — and therefore how the export is ordered too. */
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [personFilter, setPersonFilter] = useState("all");
  const [search, setSearch] = useState("");

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
    setExportCategories(null);
    // A new range is a new decision — never carry the consent across.
    setAcceptUnverified(false);
    return () => {
      cancelled = true;
    };
  }, [householdId, rangeFrom, rangeTo]);

  if (household === null || user === null) return null;

  // Everything the range returned, before the category picker narrows it.
  const rangeRows = loadState.rows;
  // ONE list: what the grid draws is what every export writes, in the same
  // order. The old page filtered for the file and showed nothing, so the only
  // way to check an export was to open it.
  const query_ = search.trim().toLowerCase();
  const filtered = rangeRows
    // `null` = every category (the default, and what a fresh range resets to).
    .filter(
      (e) => exportCategories === null || exportCategories.includes(e.categoryId),
    )
    .filter((e) => personFilter === "all" || e.createdBy === personFilter)
    .filter((e) => query_ === "" || e.note.toLowerCase().includes(query_));

  const compare = (a: Expense, b: Expense): number => {
    switch (sortKey) {
      case "amount":
        return a.amountCents - b.amountCents;
      case "amountUsd":
        // Unverified rows have no USD at all. They sort as zero rather than
        // being dropped: the column is blank in the file too, and a row that
        // vanished from the grid when you sorted by it would look like a bug.
        return (a.usdCents ?? 0) - (b.usdCents ?? 0);
      case "category":
        return catLabelOf(a.categoryId).localeCompare(catLabelOf(b.categoryId));
      case "note":
        return a.note.localeCompare(b.note);
      case "person":
        return (memberNames[a.createdBy] ?? "").localeCompare(
          memberNames[b.createdBy] ?? "",
        );
      default:
        return a.date.localeCompare(b.date);
    }
  };
  const rows = [...filtered].sort((a, b) => {
    const primary = compare(a, b);
    // Date breaks every tie, so equal amounts stay in a sensible order instead
    // of whatever the previous sort happened to leave behind.
    const resolved = primary !== 0 ? primary : a.date.localeCompare(b.date);
    return sortAsc ? resolved : -resolved;
  });
  const total = rows.reduce((sum, e) => sum + e.amountCents, 0);
  // USD only ever sums what the bank has actually reported.
  const totalUsd = rows.reduce((sum, e) => sum + (e.usdCents ?? 0), 0);
  const unverifiedCount = rows.filter((e) => !e.verified).length;
  // Exporting a range with expenses the bank has not confirmed yet is allowed,
  // but only deliberately: the checkbox has to be ticked first.
  const exportBlocked = unverifiedCount > 0 && !acceptUnverified;
  const canExport =
    !loadState.loading && rows.length > 0 && range !== null && !exportBlocked;

  /** Categories actually present in the loaded range — no point offering to
   * filter by one with nothing in it. */
  const rangeCategoryIds = [...new Set(rangeRows.map((e) => e.categoryId))];
  const toggleExportCategory = (id: string) => {
    const current = exportCategories ?? rangeCategoryIds;
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    setExportCategories(next);
  };
  const fileBase =
    range !== null ? `gastos-${range.startDate}_${range.endDate}` : "gastos";

  /** Same column twice flips the direction; a new one starts ascending. */
  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

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

  /** The one payload every branded export renders — PDF, Excel and Sheets. */
  const buildExportPayload = (extension: string): PdfExportOptions | null => {
    if (range === null) return null;
    const totalsMap = new Map<string, { aud: number; usd: number }>();
    for (const e of rows) {
      const prev = totalsMap.get(e.categoryId) ?? { aud: 0, usd: 0 };
      totalsMap.set(e.categoryId, {
        aud: prev.aud + e.amountCents,
        usd: prev.usd + (e.usdCents ?? 0),
      });
    }
    const categoryTotals = [...totalsMap.entries()]
      .map(([id, sums]) => ({
        label: catLabelOf(id),
        amountCents: sums.aud,
        usdCents: sums.usd,
      }))
      .sort((a, b) => b.amountCents - a.amountCents);
    return {
      filename: `${fileBase}.${extension}`,
      title: "Gastos Diarios",
      householdName: household.name,
      rangeLabel: `${formatPeriodRange(range.startDate, range.endDate, locale, "short")} ${range.endDate.slice(0, 4)}`,
      rows: rows.map((e) => ({
        date: e.date,
        categoryLabel: catLabelOf(e.categoryId),
        note: e.note,
        memberLabel: memberNames[e.createdBy] ?? e.createdBy,
        amountCents: e.amountCents,
        usdCents: e.usdCents,
      })),
      categoryTotals,
      grandTotalCents: total,
      grandTotalUsdCents: totalUsd,
      unverifiedCount,
      currency: household.currency,
      locale,
      labels: {
        date: t("colDate"),
        category: t("colCategory"),
        note: t("colNote"),
        person: t("colPerson"),
        amount: t("colAmount"),
        amountUsd: t("colAmountUsd"),
        byCategory: t("byCategory"),
        total: t("total"),
        countLine: t("expensesCount", { count: rows.length }),
        unverifiedNotice: t("unverifiedNotice", { count: unverifiedCount }),
      },
    };
  };

  const exportPdf = async () => {
    const payload = buildExportPayload("pdf");
    if (payload !== null) await exportExpensesPdf(payload);
  };

  const exportExcel = async () => {
    const payload = buildExportPayload("xlsx");
    if (payload === null) return;
    setExportPhase("excel");
    try {
      downloadWorkbook(payload.filename, await buildExpensesWorkbook(payload));
      setExportPhase("idle");
    } catch {
      setExportPhase("error");
    }
  };

  const exportDrive = async () => {
    const payload = buildExportPayload("xlsx");
    const fb = getFirebaseClient();
    if (payload === null || fb === null) return;
    setExportPhase("drive");
    try {
      const url = await exportToGoogleDrive(
        fb.auth,
        payload.filename,
        await buildExpensesWorkbook(payload),
      );
      setExportPhase("idle");
      window.open(url, "_blank", "noopener");
    } catch (error) {
      // Closing Google's dialog is a choice, not a failure worth shouting
      // about; the installed app hitting Google's popup limit is neither, and
      // deserves the one instruction that actually helps.
      const kind =
        error instanceof DriveExportError ? error.kind : "upload";
      setExportPhase(
        kind === "cancelled"
          ? "idle"
          : kind === "standalone"
            ? "driveStandalone"
            : "error",
      );
    }
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
            <Icon name="database" size={17} className="text-accent-strong" />
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-bold text-ink">
              {t("viewTitle")}
            </span>
            <span className="text-xs text-ink-3">{t("viewHint")}</span>
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

        {exportPhase === "error" && (
          <span className="text-[12.5px] font-semibold text-over">
            {t("exportError")}
          </span>
        )}
        {exportPhase === "driveStandalone" && (
          <span className="text-[12.5px] font-semibold text-warn-text">
            {t("exportDriveStandalone")}
          </span>
        )}

        {/* Which categories go into the export */}
        {rangeCategoryIds.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-soft pt-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-2">
                {t("categoriesLabel")}
              </span>
              <button
                type="button"
                onClick={() => setExportCategories(null)}
                disabled={exportCategories === null}
                className="text-[12px] font-semibold text-accent-strong disabled:text-ink-3"
              >
                {t("categoriesAll")}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rangeCategoryIds.map((id) => {
                const on =
                  exportCategories === null || exportCategories.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleExportCategory(id)}
                    className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${
                      on
                        ? "border-transparent bg-accent-soft text-accent-strong"
                        : "border-pill bg-surface text-ink-3"
                    }`}
                  >
                    {catLabelOf(id)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Who, and any word in the note. Same filter vocabulary as the
            Gastos list, because it is the same question asked of the same
            rows — and every one of them narrows the export too. */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-soft pt-3.5">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
            {t("colPerson")}
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="cursor-pointer rounded-[10px] border border-pill bg-bg px-2.5 py-2 text-[13px] font-semibold text-ink outline-none"
            >
              <option value="all">{t("personAll")}</option>
              {Object.entries(memberNames).map(([uid, name]) => (
                <option key={uid} value={uid}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-full border border-pill bg-bg px-3.5 py-2">
            <Icon name="search" size={16} className="text-ink-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchNote")}
              aria-label={t("searchNote")}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        </div>

        {/* Unverified gate: the range still has expenses the bank has not
            confirmed, so their USD column will be blank. Exporting anyway is a
            deliberate act, not a default. */}
        {unverifiedCount > 0 && !loadState.loading && rows.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-[14px] border border-warn-bg bg-warn-bg px-3.5 py-3">
            <input
              type="checkbox"
              checked={acceptUnverified}
              onChange={(e) => setAcceptUnverified(e.target.checked)}
              className="mt-px h-4 w-4 flex-none accent-[var(--warn-text)]"
            />
            <span className="flex flex-col gap-px">
              <span className="text-[13px] font-bold text-warn-text">
                {t("acceptUnverified")}
              </span>
              <span className="text-[11.5px] font-semibold text-warn-text opacity-80">
                {t("unverifiedNotice", { count: unverifiedCount })}
              </span>
            </span>
          </label>
        )}

        {/* Taking it with you. Four small secondary buttons, all the same
            weight: the file is just a copy of the table below, so none of them
            is the point of the screen any more — and none is more of an event
            than the others. Each writes exactly what is on screen, in the
            order it is on screen. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-soft pt-3.5">
          <span className="text-[12px] font-semibold text-ink-3">
            {t("exportHint")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: "csv", label: t("exportCsv"), run: exportCsv },
                { key: "pdf", label: t("exportPdf"), run: () => void exportPdf() },
                {
                  key: "excel",
                  label: exportPhase === "excel" ? t("exporting") : t("exportExcel"),
                  run: () => void exportExcel(),
                  busy: exportPhase === "excel",
                },
                {
                  key: "drive",
                  label:
                    exportPhase === "drive" ? t("exportingDrive") : t("exportDrive"),
                  run: () => void exportDrive(),
                  busy: exportPhase === "drive",
                },
              ] as const
            ).map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={action.run}
                disabled={!canExport || ("busy" in action && action.busy)}
                className="flex items-center gap-1.5 rounded-full border border-pill bg-surface px-3.5 py-1.5 text-[12.5px] font-bold text-ink-2 disabled:opacity-40"
              >
                <Icon name="download" size={14} className="text-ink-3" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>


      {/* ── The grid ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="section-label">{t("gridTitle")}</span>
          <span className="text-[11.5px] text-ink-3">{t("gridHint")}</span>
        </div>

        {loadState.loading ? (
          <p className="py-6 text-center text-[13px] text-ink-3">
            {t("loading")}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-3">
            {t("exportEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-soft text-ink-3">
                  <SortHeader
                    label={t("colDate")}
                    columnKey="date"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortHeader
                    label={t("colCategory")}
                    columnKey="category"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortHeader
                    label={t("colNote")}
                    columnKey="note"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortHeader
                    label={t("colPerson")}
                    columnKey="person"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortHeader
                    label={t("colAmount")}
                    columnKey="amount"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                    align="right"
                  />
                  <SortHeader
                    label={t("colAmountUsd")}
                    columnKey="amountUsd"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-soft">
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-ink">
                      {formatShortDate(e.date, locale)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink">
                      {catLabelOf(e.categoryId)}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-ink-2">
                      {e.note !== "" ? e.note : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                      {memberNames[e.createdBy] ?? "—"}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">
                      {formatCents(e.amountCents, household.currency, locale)}
                    </td>
                    {/* Blank, not zero, when the bank has not reported it —
                        exactly what the spreadsheet writes into that cell. */}
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-3">
                      {e.usdCents !== null ? formatUsd(e.usdCents, locale) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-bold text-ink">
                  <td className="px-3 py-2.5" colSpan={4}>
                    {t("expensesCount", { count: rows.length })}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    {formatCents(total, household.currency, locale)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-ink-2">
                    {totalUsd > 0 ? formatUsd(totalUsd, locale) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** A column heading that sorts. Clicking the active one flips the direction. */
function SortHeader({
  label,
  columnKey,
  sortKey,
  sortAsc,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === columnKey;
  return (
    <th
      className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`}
      // The one attribute that tells a screen reader the table is sorted at
      // all, and by which column.
      aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 ${
          active ? "text-ink" : "text-ink-3"
        }`}
      >
        {label}
        <Icon
          name={active && !sortAsc ? "keyboard_arrow_down" : "keyboard_arrow_up"}
          size={14}
          className={active ? "text-accent-strong" : "text-transparent"}
        />
      </button>
    </th>
  );
}
