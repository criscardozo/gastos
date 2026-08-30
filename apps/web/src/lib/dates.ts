// Locale-aware calendar-date label formatting for "YYYY-MM-DD" strings.
// Parsing is done by components (never Date-with-timezone) so labels can
// never shift a day.

function parts(date: string): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** A Date safe for FORMATTING only (local midday avoids DST edge shifts). */
function toFormatDate(date: string): Date {
  const { year, month, day } = parts(date);
  return new Date(year, month - 1, day, 12);
}

function numberLocale(locale: string): string {
  return locale === "es" ? "es-AR" : "en-AU";
}

function monthName(date: string, locale: string, style: "short" | "long"): string {
  const name = new Intl.DateTimeFormat(numberLocale(locale), {
    month: style,
  }).format(toFormatDate(date));
  return name.replace(/\.$/, "");
}

/**
 * Period range label. Long: "1 – 14 de julio" (es) / "1 – 14 July" (en).
 * Short: "1 – 14 jul". Cross-month: "28 dic – 3 ene".
 */
export function formatPeriodRange(
  startDate: string,
  endDate: string,
  locale: string,
  style: "short" | "long" = "long",
): string {
  const start = parts(startDate);
  const end = parts(endDate);
  const sameMonth = start.year === end.year && start.month === end.month;
  if (sameMonth) {
    const month = monthName(endDate, locale, style);
    return locale === "es" && style === "long"
      ? `${start.day} – ${end.day} de ${month}`
      : `${start.day} – ${end.day} ${month}`;
  }
  const m1 = monthName(startDate, locale, "short");
  const m2 = monthName(endDate, locale, "short");
  // Years only when the range crosses one. "1 sep – 31 ago" is a whole year
  // that reads as a fortnight in the wrong order; every other range is inside
  // one year, where the day and month already say everything.
  if (start.year !== end.year) {
    return `${start.day} ${m1} ${start.year} – ${end.day} ${m2} ${end.year}`;
  }
  return `${start.day} ${m1} – ${end.day} ${m2}`;
}

/** Day heading: "sábado 11 jul" (es) / "Saturday 11 Jul" (en). */
export function formatDayHeading(date: string, locale: string): string {
  const d = toFormatDate(date);
  const weekday = new Intl.DateTimeFormat(numberLocale(locale), {
    weekday: "long",
  }).format(d);
  const month = monthName(date, locale, "short");
  return `${weekday} ${parts(date).day} ${month}`;
}

/** Long single date: "miércoles 1 de julio" (es) / "Wednesday 1 July" (en). */
export function formatLongDate(date: string, locale: string): string {
  const d = toFormatDate(date);
  const weekday = new Intl.DateTimeFormat(numberLocale(locale), {
    weekday: "long",
  }).format(d);
  const month = monthName(date, locale, "long");
  const { day } = parts(date);
  return locale === "es"
    ? `${weekday} ${day} de ${month}`
    : `${weekday} ${day} ${month}`;
}

/**
 * A whole month, named: "agosto 2026" / "August 2026".
 *
 * Carries the year always, unlike the day formats: a month is a window somebody
 * navigates back through, and "agosto" on its own is ambiguous the moment there
 * is more than one of them in the list.
 */
export function formatMonthLabel(date: string, locale: string): string {
  const month = monthName(date, locale, "long");
  return `${month} ${date.slice(0, 4)}`;
}

/** Compact single date: "11 jul". */
export function formatShortDate(date: string, locale: string): string {
  return `${parts(date).day} ${monthName(date, locale, "short")}`;
}

/**
 * The year, appended only when it is not the current one.
 *
 * Expenses are always within days of today, so their dates say no year and
 * nobody misses it. A yearly service is different: "3 ago" for something due in
 * 2027 reads as the day after tomorrow. This keeps the short form for the
 * common case and disambiguates the one that needs it.
 */
function withYearIfNotThis(
  formatted: string,
  date: string,
  today: string,
): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? formatted
    : `${formatted} ${date.slice(0, 4)}`;
}

/** "3 ago" this year, "3 ago 2027" beyond it. */
export function formatShortDateInYear(
  date: string,
  today: string,
  locale: string,
): string {
  return withYearIfNotThis(formatShortDate(date, locale), date, today);
}

/** "martes 3 de agosto" this year, "martes 3 de agosto 2027" beyond it. */
export function formatLongDateInYear(
  date: string,
  today: string,
  locale: string,
): string {
  return withYearIfNotThis(formatLongDate(date, locale), date, today);
}
