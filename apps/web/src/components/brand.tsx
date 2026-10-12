// Brand marks: the app's own icon as a tile (docs/design/app-icon), plus the
// official Google "G".
import { APP_MARK_DARK, APP_MARK_LIGHT } from "@/components/app-mark-art";

/**
 * The app icon, drawn inline at any size — the same art as the home-screen
 * icon and the favicon, generated from the same drawings (app-mark-art.ts).
 *
 * Both appearances are in the markup and globals.css shows one, following the
 * same light/dark rule as the tokens, manual override included: an <img> or a
 * <picture> could only follow the system setting.
 */
export function AppMark({
  size = 24,
  className,
}: {
  /** Pixel size of the square tile. */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <g className="app-mark-light" dangerouslySetInnerHTML={{ __html: APP_MARK_LIGHT }} />
      <g className="app-mark-dark" dangerouslySetInnerHTML={{ __html: APP_MARK_DARK }} />
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
