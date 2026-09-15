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
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WEB = REPO / "apps/web/src"
IOS = REPO / "apps/ios/Gastos"

TEXT = {"xs": 12.0, "sm": 14.0, "base": 16.0, "lg": 18.0, "xl": 20.0,
        "2xl": 24.0, "3xl": 30.0, "4xl": 36.0}
RADIUS = {"sm": 4.0, "md": 6.0, "lg": 8.0, "xl": 12.0, "2xl": 16.0, "3xl": 24.0}
SPACE_UNIT = 4.0  # Tailwind: 1 = 0.25rem


def _code(text: str) -> str:
    """`text` with comment-ONLY lines dropped, for counting real usage.

    Every count here feeds a decision — which type steps and radii earn a place
    in the scale — and a count absorbs a wrong number without looking wrong. A
    doc comment that shows a call as an example, which is how this codebase
    documents, would be counted as a use of it.

    Line-based, and deliberately not a regex that strips from `//` to the end:
    there are URLs inside string literals in these files, and that regex eats
    the middle of every one of them. The trade is a known hole — a comment at
    the END of a line of code still counts — and a hole is better than a rule
    that corrupts strings, because the hole is at least the same shape as the
    thing it misses.

    Measured when this was added: 671 counted occurrences across the web and iOS
    sweeps, NONE of them on a comment line. So this changes no number today; it
    stops one changing silently later.
    """
    keep = []
    for line in text.split("\n"):
        s = line.lstrip()
        if s.startswith(("//", "*", "/*", "{/*", "#")):
            continue
        keep.append(line)
    return "\n".join(keep)


def _sources(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    """Source files under `root`: tracked, plus new ones git does not ignore.

    The file set is part of the measurement and gets stated here rather than
    defaulted, because both ways of defaulting are wrong and each has drawn
    blood:

      - walking the filesystem sweeps BUILD OUTPUT. `apps/ios/build/` and
        `build-device/` are gitignored, and they hold the dependencies' own
        sources. Kyber hit this counting radii in the sibling project: 2246
        files instead of 53, and three of the five values it reported did not
        exist in that code. It does not bite here today only because nothing
        has been compiled without cleaning.
      - listing only what is TRACKED misses a file written a minute ago, which
        is exactly when it exists: you write it, run the sweep, stage it after.
        A new screen with ten uses of an off-scale radius would pass.

    `--cached --others --exclude-standard` is both halves at once, and it is
    the same answer this repo reached from the other direction for the sweeps
    that claim completeness.
    """
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z",
         "--", str(root.relative_to(REPO))],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout
    return sorted(REPO / p for p in out.split("\0") if p.endswith(suffixes))


def _files() -> list[Path]:
    # `.ts` as well as `.tsx`: the class strings every dialog in the app shares
    # live in `components/ui/dialog-shell.ts`, which has no JSX in it and so
    # was outside a `.tsx`-only sweep. The sheet's 24px radius, its 12px field
    # radius and its type size were all invisible for that reason alone.
    return _sources(WEB, (".tsx", ".ts"))


def _ios_files() -> list[Path]:
    return _sources(IOS, (".swift",))


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
        text = _code(f.read_text())
        for m in re.finditer(r'\btext-\[([0-9.]+)px\]([^"\n]*)', text):
            size, ctx = float(m.group(1)), m.group(2)
            seen.setdefault(size, {}).setdefault(_weight(ctx), 0)
            seen[size][_weight(ctx)] += 1
        for m in re.finditer(r'\btext-(' + "|".join(TEXT) + r')\b([^"\n]*)', text):
            size, ctx = TEXT[m.group(1)], m.group(2)
            seen.setdefault(size, {}).setdefault(_weight(ctx), 0)
            seen[size][_weight(ctx)] += 1
    return sorted(seen.items(), key=lambda kv: -sum(kv[1].values()))


def _counted(utility: str, arbitrary: str, named: dict[str, float] | None,
             scale: float | None) -> list[tuple[float, int]]:
    """Count one utility's values, in all three spellings it can be written.

    `utility` is passed in rather than sliced out of `arbitrary`. It used to be
    derived (`arbitrary.split("-")[0]`), which is a derivation that breaks the
    moment the arbitrary pattern grows a `-` of its own — and it did, when the
    radius pattern had to allow `rounded-t-[24px]`. It would not have raised:
    the named sweep would have quietly started matching nothing.
    """
    seen: dict[float, int] = {}
    for f in _files():
        text = _code(f.read_text())
        for v in re.findall(arbitrary, text):
            seen[float(v)] = seen.get(float(v), 0) + 1
        if named:
            for k in re.findall(r"\b" + utility + r"-(" + "|".join(map(re.escape, named))
                                + r")\b", text):
                seen[named[k]] = seen.get(named[k], 0) + 1
        if scale:
            for v in re.findall(r"\b" + utility + r"-([0-9]+(?:\.5)?)\b", text):
                px = float(v) * scale
                seen[px] = seen.get(px, 0) + 1
    return sorted(seen.items(), key=lambda kv: -kv[1])


# `rounded-t-[24px]`, `rounded-b-[4px]`: the side is which corners get the
# radius, not a different radius. Counting only the undirected spelling hid
# the dialog top — 24px — which is on every sheet in the app and was one use
# short of being a rung. Same shape as this module's founding bug, where
# `text-sm` was invisible beside `text-[14px]`.
SIDE = r"(?:-(?:[trbl]|[tb][lr]|[xy]|[se]|[tb][se]|[se][se]))?"


def radii() -> list[tuple[float, int]]:
    """Explicit radii in px. `rounded-full` is counted separately — it is a
    shape rule, not a number."""
    return _counted("rounded", r"\brounded" + SIDE + r"-\[([0-9.]+)px\]", RADIUS, None)


def full_radius_uses() -> int:
    return sum(len(re.findall(r"\brounded" + SIDE + r"-full\b", _code(f.read_text())))
               for f in _files())


def padding_x() -> list[tuple[float, int]]:
    return _counted("px", r"\bpx-\[([0-9.]+)px\]", None, SPACE_UNIT)


def gaps() -> list[tuple[float, int]]:
    return _counted("gap", r"\bgap-\[([0-9.]+)px\]", None, SPACE_UNIT)


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
    for f in _ios_files():
        for m in re.finditer(r"\.appFont\(([0-9.]+)(?:,\s*\.(\w+))?\)", _code(f.read_text())):
            size = float(m.group(1))
            w = names.get(m.group(2) or "regular", 400)
            seen.setdefault(size, {}).setdefault(w, 0)
            seen[size][w] += 1
    return sorted(seen.items(), key=lambda kv: -sum(kv[1].values()))


def ios_radii() -> list[tuple[float, int]]:
    """The same measurement `radii()` does for web, on the other client.

    Reported by Kyber: `coverage()` only ever called `radii()`, which walks
    `_files()` — web `.tsx` only — so a corner radius with no web equivalent
    was invisible to the off-scale check while the message still read as if
    it covered both platforms. iOS spells this `RoundedRectangle(cornerRadius:
    N, style: .continuous)`; a variable (`cornerRadius: radius`) is not a
    literal and does not match, same reasoning as excluding `rounded-full` from
    `radii()` — a shape rule, not a number.
    """
    seen: dict[float, int] = {}
    for f in _ios_files():
        for m in re.finditer(r"cornerRadius:\s*([0-9.]+)", _code(f.read_text())):
            v = float(m.group(1))
            seen[v] = seen.get(v, 0) + 1
    return sorted(seen.items(), key=lambda kv: -kv[1])


def ios_full_radius_uses() -> int:
    """iOS spells the shape rule `Capsule()`; web spells it `rounded-full`."""
    return sum(len(re.findall(r"\bCapsule\(\)", _code(f.read_text())))
               for f in _ios_files())


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
