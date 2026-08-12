// Brand marks from the design system (docs/design, turn 5): the geometric
// piggy with a coin dropping in, plus the official Google "G".

interface PiggyMarkProps {
  /** Pixel size of the square mark. */
  size?: number;
  /** Body color scheme: cream body on coral tiles, coral body on light bg. */
  variant?: "cream" | "coral" | "ink";
  className?: string;
}

const PIGGY_COLORS: Record<
  NonNullable<PiggyMarkProps["variant"]>,
  { body: string; detail: string; coin: string; slot: string }
> = {
  // body = pig + steam; detail = eye/nostrils/slot accents; coin fill; slot on coin
  cream: { body: "#FAF6EF", detail: "#FF5C39", coin: "#FAF6EF", slot: "#FF5C39" },
  coral: { body: "#FF5C39", detail: "#FAF6EF", coin: "#FF5C39", slot: "#FAF6EF" },
  ink: { body: "#FAF6EF", detail: "#241A10", coin: "#FF5C39", slot: "#FAF6EF" },
};

export function PiggyMark({
  size = 24,
  variant = "cream",
  className,
}: PiggyMarkProps) {
  const c = PIGGY_COLORS[variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M18 54 a6 6 0 1 1 -1.5 -9.5"
        fill="none"
        stroke={c.body}
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <rect x="29" y="70" width="10" height="14" rx="5" fill={c.body} />
      <rect x="55" y="70" width="10" height="14" rx="5" fill={c.body} />
      <ellipse cx="47" cy="56" rx="31" ry="25" fill={c.body} />
      <rect x="70" y="47.5" width="20" height="17" rx="8.5" fill={c.body} />
      <circle cx="81" cy="56" r="2.3" fill={c.detail} />
      <circle cx="86.5" cy="56" r="2.3" fill={c.detail} />
      <path d="M54 33.5 Q58 21.5 67 24.5 Q71.5 27.5 64.5 36 Z" fill={c.body} />
      <circle cx="60.5" cy="49" r="3" fill={c.detail} />
      <rect x="36" y="34" width="15" height="4.6" rx="2.3" fill={c.detail} />
      <circle cx="43" cy="16.5" r="8.8" fill={c.coin} />
      <rect x="41.2" y="11.8" width="3.6" height="9.4" rx="1.8" fill={c.slot} />
    </svg>
  );
}

/** Official multi-colour Google "G" mark. */
export function GoogleG({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
