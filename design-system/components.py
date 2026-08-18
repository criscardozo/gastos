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


def variants(pattern: str) -> list[tuple[str, int, int]]:
    """Every variant matching `pattern`: (classes, uses, distinct files).

    Deliberately BROAD. The field spec published a 2-use variant that lives only
    in onboarding while a 15-use one runs five daily screens — not because the
    ranking was wrong but because the PATTERN was: it asked for `border-line`,
    excluding the dominant `border-pill`, and a `rounded` matcher that did not accept
    bracketed values, so `rounded-[10px]` never matched either. Having pre-filtered
    on two axes, "most common" faithfully reported the most common of the subset
    I had already chosen.

    So patterns here match the whole family, and `dominant()` picks the winner.
    """
    found: dict[str, list[str]] = {}
    for f in sorted(WEB.rglob("*.tsx")):
        for m in re.findall(pattern, f.read_text()):
            key = re.sub(r"\s+", " ", m if isinstance(m, str) else m[0]).strip()
            found.setdefault(key, []).append(str(f))
    return sorted(((k, len(v), len(set(v))) for k, v in found.items()),
                  key=lambda t: -t[1])


class NotRepresentative(Exception):
    """Raised rather than publishing a variant that is not the common one."""


MIN_USES = 8  # the same floor the type scale uses; below it, a step is noise


def family(label: str, pattern: str, invariant: str) -> tuple[str, int]:
    """For a component with no single dominant string: the invariant + sizes.

    The primary button is the case. Its four variants are legitimately different
    — a screen CTA, an inline primary, a full-width one in a dialog, a small one
    — and no exact string reaches the floor, so there is nothing to crown. What
    IS constant is `rounded-full bg-accent` with white 700 text; the sizes are
    variants of a role, not competitors for one anatomy. Publishing the 4-use
    string as "the primary button" was the same minority-variant defect as the
    field, arrived at from the other direction.
    """
    vs = variants(pattern)
    total = sum(u for _, u, _ in vs)
    lines = [f"invariante  {invariant}", ""]
    lines += [f"{u:>3} usos  {k}" for k, u, _ in vs[:5]]
    assert_attributable(label, invariant)
    return "\n".join(lines), total


def dominant(label: str, pattern: str) -> tuple[str, int, int]:
    """The most-used variant, refusing to publish a minority or a rarity.

    Two ways to get this wrong, and the type scale had already answered both —
    a step earns its place at 8 uses, and the frequent one wins. That floor was
    written for type and never applied to components, which is how a 2-use field
    got published as the field.
    """
    vs = variants(pattern)
    if not vs:
        raise NotRepresentative(f"{label}: el patrón no encontró nada")
    top, uses, files = vs[0]
    if uses < MIN_USES:
        raise NotRepresentative(
            f"{label}: la variante más usada tiene sólo {uses} usos, por debajo del "
            f"piso de {MIN_USES}. Es ruido, no anatomía.")
    assert_attributable(label, top)
    return top, uses, files


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
        # Broad enough to see every variant of each family; `dominant` picks.
        "card":      dominant("card",      r'rounded-[\w\[\]0-9px]+ border border-\w+ bg-surface[^"`]{0,45}'),
        # No single string reaches the floor: these are one role in several
        # sizes, so the invariant is published and the sizes listed under it.
        "primary":   family("primary", r'rounded-full bg-accent[^"`]{0,70}',
                            "rounded-full bg-accent + texto blanco 700"),
        "secondary": family("secondary", r'rounded-full border border-pill[^"`]{0,60}',
                            "rounded-full border border-pill + texto ink 700"),
        # Also a family, and this is where the defect was worst: the published
        # anatomy was a 2-use variant living only in onboarding, while five
        # daily screens use another. Its 15 uses are not one string either —
        # they share a prefix and differ in padding — so the invariant is what
        # there is to publish.
        "field":     family("field", r'rounded-[\w\[\]0-9px]+ border border-\w+ bg-bg[^"`]{0,60}',
                            "rounded-[10px] border border-pill bg-bg"),
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
