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
    return {
        "card":      _most_common(r'rounded-\[[0-9]+px\][^"]{0,70}bg-surface[^"]{0,40}'),
        "primary":   _most_common(r'rounded-full bg-accent[^"]{0,70}'),
        "secondary": _most_common(r'rounded-full border border-pill[^"]{0,60}'),
        "field":     _most_common(r'rounded-\w+ border border-line bg-bg[^"]{0,70}'),
    }


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


if __name__ == "__main__":
    for name, (classes, n) in anatomy().items():
        print(f"  {name:<10} ×{n}  {classes}")
    print(f"  filas:     {row_padding()}")
    print(f"  divisores: {dividers()}")
