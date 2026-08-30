"use client";

// The chart primitives for Estadísticas — styled divs and hand-written SVG, no
// charting library. That is a project rule, and at this size it costs nothing:
// a bar is a div with a width, a line is a polyline. What a library would add
// here is 50–100 kB on the first load of an app whose whole point is opening
// fast on a phone.
//
// None of these know about money or dates: the page formats every label and
// hands them numbers.

import type { ReactNode } from "react";

import { CurrencyTag } from "@/components/ui/marks";

/** One labelled horizontal bar. `fraction` is 0..1 of the widest row. */
export function BarRow({
  label,
  value,
  fraction,
  color = "var(--accent)",
  meta,
}: {
  label: ReactNode;
  value: string;
  fraction: number;
  color?: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold text-ink">
          {label}
        </span>
        <span className="flex flex-none items-baseline gap-1.5">
          {meta !== undefined && (
            <span className="text-[11px] text-ink-3">{meta}</span>
          )}
          <span className="tnum text-[13px] font-bold text-ink">{value}</span>
        </span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Vertical bars, one per day. Bars only — no axis: the numbers that matter are
 * in the cards above, and a phone-width axis of 90 dates is unreadable anyway.
 * Every bar carries its own title so a hover (or a screen reader) can name it.
 */
/**
 * How much air between the bars.
 *
 * A fortnight can afford 3px; a year cannot — 365 bars with a 3px gap need
 * about 1800px of minimum width, which is not a chart, it is a horizontal
 * scrollbar. Past a couple of months the gap goes away and the bars become a
 * dense band, which is the right way to read that much data anyway.
 */
function barGap(count: number): number {
  if (count <= 40) return 3;
  if (count <= 100) return 1;
  return 0;
}

export function DayBars({
  points,
  labelFor,
  valueFor,
  highlight,
}: {
  points: { date: string; totalCents: number }[];
  labelFor: (date: string) => string;
  valueFor: (cents: number) => string;
  /** Dates to tint differently — used for the days that had no spending. */
  highlight?: (point: { date: string; totalCents: number }) => boolean;
}) {
  const max = Math.max(...points.map((p) => p.totalCents), 1);
  return (
    <div className="flex h-[120px] items-end" style={{ gap: barGap(points.length) }}>
      {points.map((p) => {
        const height = (p.totalCents / max) * 100;
        return (
          <div
            key={p.date}
            title={`${labelFor(p.date)} · ${valueFor(p.totalCents)}`}
            className="flex-1 rounded-t-[3px]"
            style={{
              // A zero day still gets a hairline, so the row reads as a
              // timeline rather than as missing data.
              height: `${Math.max(height, 1.5)}%`,
              minWidth: 1,
              background:
                p.totalCents === 0
                  ? "var(--track)"
                  : highlight?.(p) === true
                    ? "var(--over)"
                    : "var(--accent)",
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The same days as DayBars, drawn as a line instead.
 *
 * Bars answer "which day was big"; a line answers "what is the shape of the
 * month". Neither is better, which is why the screen offers both rather than
 * picking. Same SVG technique as PaceChart — a 0–100 viewBox stretched with
 * preserveAspectRatio="none", so it fits any width without being measured.
 */
export function DayLine({
  points,
}: {
  points: { date: string; totalCents: number }[];
}) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.totalCents), 1);
  // A single day has no line to draw, so it sits in the middle of the box
  // rather than at x=0 where it would look like the start of a missing series.
  const x = (i: number) =>
    points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
  const y = (cents: number) => 100 - (cents / max) * 100;
  const line = points.map((p, i) => `${x(i)},${y(p.totalCents)}`).join(" ");

  return (
    <div className="h-[120px] w-full">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        <polygon
          points={`${x(0)},100 ${line} ${x(points.length - 1)},100`}
          fill="var(--accent)"
          opacity="0.14"
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/**
 * The day labels under a day chart.
 *
 * One slot per point, in the same flex layout the bars use, so a label always
 * sits under the day it names — computing positions separately is how axes
 * drift out of alignment. Only some slots print: a month of 31 labels is
 * unreadable on a phone, so this thins them to roughly `maxLabels`, always
 * keeping the first and the last.
 */
export function DayAxis({
  points,
  labelFor,
  maxLabels = 8,
}: {
  points: { date: string }[];
  labelFor: (date: string) => string;
  maxLabels?: number;
}) {
  if (points.length === 0) return null;
  const step = Math.max(1, Math.ceil(points.length / maxLabels));
  const last = points.length - 1;
  return (
    // Same gap as the bars, so a label sits under the day it names.
    <div className="flex" style={{ gap: barGap(points.length) }} aria-hidden>
      {points.map((p, i) => (
        <span
          key={p.date}
          className="min-w-0 flex-1 whitespace-nowrap text-center text-[9.5px] leading-tight text-ink-3"
          style={{ minWidth: 1 }}
        >
          {/* The last one always prints, and never on top of its neighbour. */}
          {i === last || (i % step === 0 && last - i >= step)
            ? labelFor(p.date)
            : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Cumulative spend against an even-pace line: are we going faster than the
 * envelope allows? Drawn as an SVG with a 0–100 viewBox and
 * preserveAspectRatio="none", so it stretches to whatever width it is given
 * without any measuring.
 */
export function PaceChart({
  spent,
  pace,
  budgetCents,
  asOfIndex,
  overLabel,
  underLabel,
}: {
  /** Cumulative spend per day, in cents. */
  spent: number[];
  /** What an even spend would have reached by each of those days. */
  pace: number[];
  budgetCents: number;
  /**
   * Which day of the range "now" is. The spend line stops there — the days
   * after it are not flat, they are unknown — and the comparison is made
   * against the pace ON that day. Comparing against the pace at the END of the
   * period instead would call the first day of a fortnight "a whole budget
   * behind schedule", which is true and useless.
   */
  asOfIndex: number;
  overLabel: string;
  underLabel: string;
}) {
  if (spent.length === 0) return null;
  const cut = Math.min(Math.max(asOfIndex, 0), spent.length - 1);
  const drawn = spent.slice(0, cut + 1);
  const max = Math.max(...drawn, ...pace, budgetCents, 1);
  const x = (i: number) =>
    spent.length === 1 ? 0 : (i / (spent.length - 1)) * 100;
  const y = (cents: number) => 100 - (cents / max) * 100;
  const line = (series: number[]) =>
    series.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `0,100 ${line(drawn)} ${x(cut)},100`;
  const last = drawn[drawn.length - 1];
  const expected = pace[cut] ?? 0;
  const ahead = last > expected;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[140px] w-full">
        {/* The series live in a stretched 0–100 box; the marker sits in a
            second, unstretched layer on top so it stays a circle. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {/* The budget line, when it fits on the chart at all. */}
          {budgetCents > 0 && budgetCents <= max && (
            <line
              x1="0"
              x2="100"
              y1={y(budgetCents)}
              y2={y(budgetCents)}
              stroke="var(--ink-tertiary)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={line(pace)}
            fill="none"
            stroke="var(--ink-tertiary)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={area}
            fill={ahead ? "var(--over-bg)" : "var(--accent-soft)"}
          />
          <polyline
            points={line(drawn)}
            fill="none"
            stroke={ahead ? "var(--over)" : "var(--accent)"}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Where the line has got to. Also the only thing visible on day one
              of a period, where a two-point polyline has just one point and
              draws nothing at all. The radius is in screen pixels, so the
              stretched viewBox cannot turn it into an ellipse. */}
        </svg>
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          <circle
            cx={`${x(cut)}%`}
            cy={`${y(last)}%`}
            r="4"
            fill={ahead ? "var(--over)" : "var(--accent)"}
            stroke="var(--surface)"
            strokeWidth="2"
          />
        </svg>
      </div>
      <span
        className="text-[11.5px] font-semibold"
        style={{ color: ahead ? "var(--over)" : "var(--good-text)" }}
      >
        {ahead ? overLabel : underLabel}
      </span>
    </div>
  );
}

/** A titled block, so the page reads as a stack of answers. */
export function StatCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  /** A control that belongs to this card, e.g. how to draw it. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="section-label">{title}</span>
          {hint !== undefined && (
            <span className="text-[11.5px] text-ink-3">{hint}</span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** One of the four headline figures. */
export function HeadlineStat({
  label,
  value,
  currency,
  meta,
}: {
  label: string;
  value: string;
  /** Marked next to the figure when given — see CurrencyTag. */
  currency?: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[16px] border border-line bg-surface px-4 py-3">
      <span className="text-[11.5px] font-semibold text-ink-2">{label}</span>
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span className="tnum text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink">
          {value}
        </span>
        {currency !== undefined && <CurrencyTag currency={currency} />}
      </span>
      {meta !== undefined && (
        <span className="text-[11px] text-ink-3">{meta}</span>
      )}
    </div>
  );
}
