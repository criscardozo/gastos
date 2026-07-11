// Pill-track segmented control matching the design (rgba fill track, white
// active thumb with a soft shadow).

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange?: (value: T) => void;
  size?: "sm" | "lg";
  disabled?: boolean;
  stretch?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  disabled = false,
  stretch = false,
}: SegmentedProps<T>) {
  const pad = size === "lg" ? "px-3 py-2.5 text-sm" : "px-3 py-1 text-xs";
  return (
    <div
      className={`flex rounded-full bg-fill p-[3px] ${stretch ? "w-full" : ""}`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange?.(opt.value);
            }}
            className={`rounded-full transition-colors ${pad} ${
              stretch ? "flex-1 text-center" : ""
            } ${
              active
                ? "bg-surface font-bold text-ink"
                : "font-semibold text-ink-2"
            } ${disabled ? "cursor-default" : ""}`}
            style={active ? { boxShadow: "var(--key-shadow)" } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
