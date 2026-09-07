#!/usr/bin/env python3
"""Count what the web components actually use — every spelling of it.

The catch this module exists for: Tailwind lets the same value be written two
ways, and counting only one of them produces a confident, wrong answer. The
first version of this counted `text-[14px]` and missed `text-sm`, so the system
documented 14.5px (5 uses) and omitted 14px/600 (24 uses) — the rare step
written down, the frequent one invisible. The Stock team found it by running the
same method with the named utilities included; 66 type uses, 28 radii and over
300 spacing values were being skipped.

So every reader here normalizes named utilities to pixels BEFORE grouping.
Scale is Tailwind v4's default: the project's `@theme inline` block only
redefines `--color-*`, so spacing stays at 1 unit = 4px and the named type and
radius steps are stock.
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WEB = REPO / "apps/web/src"
IOS = REPO / "apps/ios/Gastos"

TEXT = {"xs": 12.0, "sm": 14.0, "base": 16.0, "lg": 18.0, "xl": 20.0,
        "2xl": 24.0, "3xl": 30.0, "4xl": 36.0}
RADIUS = {"sm": 4.0, "md": 6.0, "lg": 8.0, "xl": 12.0, "2xl": 16.0, "3xl": 24.0}
SPACE_UNIT = 4.0  # Tailwind: 1 = 0.25rem


def _files() -> list[Path]:
    return sorted(WEB.rglob("*.tsx"))


def _weight(context: str) -> int:
    return (700 if "font-bold" in context else
            600 if "font-semibold" in context else
            500 if "font-medium" in context else 400)


def type_steps() -> list[tuple[float, dict[int, int]]]:
    """(size, {weight: uses}) — both spellings, most-used first.

    Size and weight are counted together because the pair is the step: 13px is
    used at 600 far more than at 400, so listing "13 / 400" would aim the next
    app at the wrong one.
    """
    seen: dict[float, dict[int, int]] = {}
    for f in _files():
        text = f.read_text()
        for m in re.finditer(r'\btext-\[([0-9.]+)px\]([^"\n]*)', text):
            size, ctx = float(m.group(1)), m.group(2)
            seen.setdefault(size, {}).setdefault(_weight(ctx), 0)
            seen[size][_weight(ctx)] += 1
        for m in re.finditer(r'\btext-(' + "|".join(TEXT) + r')\b([^"\n]*)', text):
            size, ctx = TEXT[m.group(1)], m.group(2)
            seen.setdefault(size, {}).setdefault(_weight(ctx), 0)
            seen[size][_weight(ctx)] += 1
    return sorted(seen.items(), key=lambda kv: -sum(kv[1].values()))


def _counted(arbitrary: str, named: dict[str, float] | None, scale: float | None
             ) -> list[tuple[float, int]]:
    seen: dict[float, int] = {}
    for f in _files():
        text = f.read_text()
        for v in re.findall(arbitrary, text):
            seen[float(v)] = seen.get(float(v), 0) + 1
        if named:
            for k in re.findall(r'\b' + arbitrary.split("-")[0].lstrip(r"\b")
                                + r"-(" + "|".join(map(re.escape, named)) + r")\b", text):
                seen[named[k]] = seen.get(named[k], 0) + 1
        if scale:
            prefix = arbitrary.split("-")[0].lstrip(r"\b")
            for v in re.findall(r'\b' + prefix + r'-([0-9]+(?:\.5)?)\b', text):
                px = float(v) * scale
                seen[px] = seen.get(px, 0) + 1
    return sorted(seen.items(), key=lambda kv: -kv[1])


def radii() -> list[tuple[float, int]]:
    """Explicit radii in px. `rounded-full` is counted separately — it is a
    shape rule, not a number."""
    return _counted(r"\brounded-\[([0-9.]+)px\]", RADIUS, None)


def full_radius_uses() -> int:
    return sum(len(re.findall(r"\brounded-full\b", f.read_text())) for f in _files())


def padding_x() -> list[tuple[float, int]]:
    return _counted(r"\bpx-\[([0-9.]+)px\]", None, SPACE_UNIT)


def gaps() -> list[tuple[float, int]]:
    return _counted(r"\bgap-\[([0-9.]+)px\]", None, SPACE_UNIT)


def ios_type_steps() -> list[tuple[float, dict[int, int]]]:
    """The same measurement on the other client.

    iOS spells type as `.appFont(size, .weight)`, and the scale it lands on is
    NOT the web's: the row step is 14.5 here and 14 there. That is not
    automatically a bug — the screen title is already 18 on iOS against 22 on
    web, on purpose, because a phone held at arm's length is not a browser
    window. What would be a bug is the system claiming a single number.
    """
    names = {"regular": 400, "medium": 500, "semibold": 600, "bold": 700, "black": 900}
    seen: dict[float, dict[int, int]] = {}
    for f in sorted(IOS.rglob("*.swift")):
        for m in re.finditer(r"\.appFont\(([0-9.]+)(?:,\s*\.(\w+))?\)", f.read_text()):
            size = float(m.group(1))
            w = names.get(m.group(2) or "regular", 400)
            seen.setdefault(size, {}).setdefault(w, 0)
            seen[size][w] += 1
    return sorted(seen.items(), key=lambda kv: -sum(kv[1].values()))


if __name__ == "__main__":
    print("tipografía (tamaño × peso):")
    for s, ws in type_steps()[:8]:
        print(f"  {s:>5g}px  " + " · ".join(f"{w}×{n}" for w, n in sorted(ws.items(), key=lambda kv: -kv[1])))
    print(f"\nradios:  " + " · ".join(f"{r:g}px×{n}" for r, n in radii()[:6]) +
          f"  · full×{full_radius_uses()}")
    print("\niOS (tamaño × peso):")
    for s_, ws in ios_type_steps()[:8]:
        print(f"  {s_:>5g}px  " + " · ".join(f"{w}×{n}" for w, n in sorted(ws.items(), key=lambda kv: -kv[1])))
    print("padding: " + " · ".join(f"{p:g}px×{n}" for p, n in padding_x()[:6]))
    print("gaps:    " + " · ".join(f"{g:g}px×{n}" for g, n in gaps()[:6]))
