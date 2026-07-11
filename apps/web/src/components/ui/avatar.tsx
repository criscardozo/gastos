import { memberColor } from "@/lib/categories";

interface AvatarProps {
  name: string;
  color: string;
  size?: number;
  ringColor?: string;
}

/** Initial-on-color member avatar. */
export function Avatar({ name, color, size = 26, ringColor }: AvatarProps) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        background: memberColor(color),
        fontSize: Math.round(size * 0.45),
        border: ringColor ? `2px solid ${ringColor}` : undefined,
        flex: "none",
      }}
    >
      {initial}
    </div>
  );
}

/** Overlapping avatar pair for the household. */
export function AvatarPair({
  members,
  size = 28,
  ringColor = "var(--surface)",
}: {
  members: { name: string; color: string }[];
  size?: number;
  ringColor?: string;
}) {
  return (
    <div className="flex">
      {members.map((m, i) => (
        <div key={i} style={{ marginLeft: i > 0 ? -Math.round(size * 0.3) : 0 }}>
          <Avatar name={m.name} color={m.color} size={size} ringColor={ringColor} />
        </div>
      ))}
    </div>
  );
}
