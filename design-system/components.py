#!/usr/bin/env python3
"""The component layer: anatomy MEASURED, rules WRITTEN.

Everything else in this package is generated end to end, and says so. This file
cannot be, and the distinction matters enough to state on every page it makes:

  · The NUMBERS are measured. Each spec's anatomy is the class string the
    components actually repeat most — `card` is the 10-use combination, not a
    number anyone chose while writing this.
  · The RULES are written. "A divider goes between rows of one list, never
    between sections" is a judgement read off the code; no tool derives it.

So a spec CAN go stale in a way the tokens no longer can. When a spec and the
code disagree, the spec is the bug.

Why not generate them: a React component and a SwiftUI view are not derivable
from each other, and a spec that only described the web would send the next iOS
app somewhere the app it is copying never went.
"""
import re
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WEB = REPO / "apps/web/src"


# Classes that name a ROLE. Geometry (rounded-*, px-*, py-*, text-*, flex) is
# shared by everything, so a count keyed on geometry alone counts no component
# in particular — which is how `py-2` got published as row padding when a third
# of it was on buttons, and `rounded-full` as the chip count when a third of it
# WAS the primary button, double-counting an element that has its own spec.
#
# The rule is the Stock team's: an anatomy key must contain at least one class
# only its component uses. Here that means at least one semantic class.
SEMANTIC = ("bg-surface", "bg-accent", "bg-bg", "border-line", "border-pill",
            "bg-fill", "bg-accent-soft", "divide-soft")


class NotAttributable(Exception):
    """Raised rather than publishing a count that measures no one component."""


def assert_attributable(label: str, key: str) -> None:
    if not any(c in key for c in SEMANTIC):
        raise NotAttributable(
            f"{label}: la clave «{key}» es sólo geometría, que muchos componentes "
            f"comparten, así que el conteo no es atribuible. Agregá una clase "
            f"semántica ({', '.join(SEMANTIC[:4])}…) o publicá el número como "
            f"frecuencia de clase, no como anatomía del componente.")


def _most_common(pattern: str) -> tuple[str, int]:
    """The variant of `pattern` the components repeat most, and how often."""
    counts: Counter[str] = Counter()
    for f in sorted(WEB.rglob("*.tsx")):
        for m in re.findall(pattern, f.read_text()):
            counts[re.sub(r"\s+", " ", m).strip()] += 1
    if not counts:
        return "", 0
    return counts.most_common(1)[0]


def anatomy() -> dict[str, tuple[str, int]]:
    """The canonical class string for each component, measured."""
    out = {
        "card":      _most_common(r'rounded-\[[0-9]+px\][^"]{0,70}bg-surface[^"]{0,40}'),
        "primary":   _most_common(r'rounded-full bg-accent[^"]{0,70}'),
        "secondary": _most_common(r'rounded-full border border-pill[^"]{0,60}'),
        "field":     _most_common(r'rounded-\w+ border border-line bg-bg[^"]{0,70}'),
    }
    for name, (classes, _) in out.items():
        assert_attributable(name, classes)
    return out


def row_padding() -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for f in sorted(WEB.rglob("*.tsx")):
        counts.update(re.findall(r"\bpy-[0-9.]+\b", f.read_text()))
    return counts.most_common(5)


def dividers() -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for f in sorted(WEB.rglob("*.tsx")):
        counts.update(re.findall(r"divide-y divide-[a-z]+|border-t border-[a-z]+", f.read_text()))
    return counts.most_common(3)


def pill_padding_share() -> tuple[int, int]:
    """(uses of py-2 on a pill or button, total uses of py-2).

    The number that makes a bare padding count unusable as a component property:
    a third of this app's py-2 is on rounded-full elements. Counting a utility
    class is not counting a component.
    """
    on_pill = total = 0
    for f in sorted(WEB.rglob("*.tsx")):
        text = f.read_text()
        total += len(re.findall(r"\bpy-2\b", text))
        on_pill += len(re.findall(r'rounded-full[^"]{0,60}\bpy-2\b|\bpy-2\b[^"]{0,60}rounded-full', text))
    return on_pill, total


def rounded_full_breakdown() -> dict[str, int]:
    """What the 80 `rounded-full` uses actually are.

    Published instead of the bare 80, because a third of them ARE the primary
    button — which has its own spec, so the two were counting the same element
    and each presenting it as its own evidence. A reader adding "80 pills" to
    "4 primary buttons" concluded the opposite of the truth: the capsule CTA is
    among the most repeated things in the app.
    """
    b = {"chip": 0, "primary": 0, "wide-button": 0, "circle": 0, "bar": 0}
    for f in sorted(WEB.rglob("*.tsx")):
        for m in re.finditer(r'[^"`]{0,120}\brounded-full\b[^"`]{0,120}', f.read_text()):
            s_ = m.group(0)
            if "bg-accent" in s_:
                b["primary"] += 1
            elif re.search(r"\bw-\[|\bh-\[|\bw-[0-9]|\bh-[0-9]", s_) and "px-" not in s_:
                b["circle"] += 1
            elif "transition-" in s_:
                b["bar"] += 1
            elif re.search(r"\bpx-", s_) and re.search(r"\bpy-", s_):
                b["chip"] += 1
            else:
                b["wide-button"] += 1
    return b


if __name__ == "__main__":
    for name, (classes, n) in anatomy().items():
        print(f"  {name:<10} ×{n}  {classes}")
    print(f"  filas:     {row_padding()}")
    print(f"  divisores: {dividers()}")
