// Material Symbols Rounded (filled), self-hosted via the material-symbols
// package (imported in the root layout).

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 18, className, style }: IconProps) {
  return (
    <span
      aria-hidden
      className={className ? `msr ${className}` : "msr"}
      style={{ fontSize: size, ...style }}
    >
      {name}
    </span>
  );
}
