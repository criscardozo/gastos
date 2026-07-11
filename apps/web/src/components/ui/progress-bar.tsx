import type { BudgetState } from "@/lib/periods";

const BAR_COLOR: Record<BudgetState, string> = {
  comfortable: "var(--good)",
  warning: "var(--warn)",
  over: "var(--over)",
};

interface ProgressBarProps {
  /** 0..1 fraction (clamped at 100%). */
  fraction: number;
  state: BudgetState;
  height?: number;
}

/** Budget progress bar: fill clamped at 100%, track tinted red when over. */
export function ProgressBar({ fraction, state, height = 12 }: ProgressBarProps) {
  const width = `${Math.min(Math.max(fraction, 0), 1) * 100}%`;
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{
        height,
        background: state === "over" ? "var(--over-track)" : "var(--track)",
      }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width, background: BAR_COLOR[state] }}
      />
    </div>
  );
}

export function stateBarColor(state: BudgetState): string {
  return BAR_COLOR[state];
}
