#!/usr/bin/env python3
"""Generate each platform's token declarations from tokens.json.

  python3 design-system/emit.py            print what each platform should say
  python3 design-system/emit.py --verify   compare against the files on disk

`--verify` is the whole point, and it is what decides when this layer is ready
to become the source rather than a mirror: when it emits, character for
character, what two people wrote by hand across two languages, then it provably
contains everything those files say. Wired into CI and the pre-push hook, so
the two can never drift.

The walking-the-document, spelling-a-value, rewrite-in-place and verify/write
machinery lives in `kyber/design/tokens.py` — Stock had written the same thing
independently, down to the same reasoning in the comments, once its own
emitter existed. What stays HERE, because it is this project's own shape and
not the other's:

  - CSS omits a dark declaration entirely when it repeats the light one
    (`--accent`, `--warn`, `--over`, `--over-text` never appear in either dark
    block) rather than writing it redundantly, which is how Stock's stylesheet
    does it.
  - Two Swift destinations with two different helpers (`Color.hex` for the
    app, `Color.widgetHex` for the widget target, which deliberately depends
    on nothing from the app and so cannot share its type).
  - `coverage()`, checking type/radius/spacing usage against the scale — there
    is no equivalent on the other side yet, so it does not qualify for the
    shared layer.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[0]

sys.path.insert(0, str(REPO / "kyber" / "design"))
import tokens as kyber_tokens  # noqa: E402

TOKENS = kyber_tokens.load(ROOT / "tokens.json")
CSS = REPO / "apps/web/src/app/globals.css"
SWIFT = REPO / "apps/ios/Gastos/Design/Theme.swift"
# The widget is a THIRD copy of these values and was outside the generator, so
# nothing held it: its target deliberately depends on nothing from the app, so
# it carries its own `Color.widgetHex` with the same signature. It carries a
# SUBSET (bg, ink, inkSecondary, inkTertiary, track); `swift_declarations`
# below declines a token the file does not already name, which is how the
# subset stays a subset without a list of its own to go stale.
WIDGET = REPO / "apps/ios/GastosWidget/WidgetTheme.swift"


def swift_name(entry: dict) -> str | None:
    return entry.get("$extensions", {}).get("gastos.swift")


def swift_declarations(path: Path, helper: str):
    """Declines a token this file does not already name — the subset rule."""
    text = path.read_text(encoding="utf-8")

    def decls(name: str, entry: dict) -> list[str]:
        if entry.get("$type") != "color":
            return []
        target = swift_name(entry)
        if not target or f"static let {target} = {helper}(" not in text:
            return []
        lv, dv = entry["$value"]["light"], entry["$value"]["dark"]
        if isinstance(lv, str):
            line = f'static let {target} = {helper}(light: "{lv.upper()}", dark: "{dv.upper()}")'
        else:
            line = (f'static let {target} = {helper}(light: "{lv["base"].upper()}", '
                    f'dark: "{dv["base"].upper()}", lightAlpha: {lv["alpha"]:.2f}, '
                    f'darkAlpha: {dv["alpha"]:.2f})')
        return [f"    {line}"]

    return decls


def swift_pattern(helper: str):
    def pattern(name: str, entry: dict) -> re.Pattern | None:
        if entry.get("$type") != "color":
            return None
        target = swift_name(entry)
        if not target:
            return None
        # `[ \t]*`, not `\s*`: the latter also matches `\n`, so anchored at the
        # start of a blank line it can swallow that blank line into the match
        # and the replacement — which does not repeat it — silently deletes
        # it. Measured: it ate the paragraph breaks between token groups in
        # the dark blocks on the first `--write`.
        return re.compile(rf"^[ \t]*static let {re.escape(target)} = {re.escape(helper)}\([^)]*\)$", re.M)

    return pattern


def css_declarations(name: str, entry: dict) -> list[str]:
    """Light, then dark — but ONLY if dark differs, because the stylesheet
    never redeclares a token whose dark value repeats the light one.

    When it does differ, the dark value appears in two physical places (the
    media-query block, 4-space indented, and the manual override, 2-space
    indented) — both are returned so `--write` rewrites both instead of
    leaving the second stale after the values list runs out.
    """
    if entry.get("$type") != "color":
        return []
    css_name = f"--{name}"
    lv = kyber_tokens.css_value(entry["$value"]["light"])
    dv = kyber_tokens.css_value(entry["$value"]["dark"])
    light_line = f"  {css_name}: {lv};"
    if dv == lv:
        return [light_line]
    return [light_line, f"    {css_name}: {dv};", f"  {css_name}: {dv};"]


def css_pattern(name: str, entry: dict) -> re.Pattern | None:
    # `[ \t]*`, not `\s*` (see the note on `swift_pattern`): the same greedy
    # cross-line match happened here first, eating the blank line before
    # `--good` in both dark blocks.
    if entry.get("$type") != "color":
        return None
    css_name = f"--{name}"
    return re.compile(rf"^[ \t]*{re.escape(css_name)}:[ \t]*[^;]+;$", re.M)


def radius_declarations(name: str, entry: dict) -> list[str]:
    """Only the radii that have a ROLE — `card`, not `r16`.

    A value nothing has decided a use for has no name worth writing into a
    theme: `Theme.r16` would be the same bare number with an alias, and the
    next person would still have to guess which one a card takes. The rNN
    entries stay in tokens.json as what they are, an inventory of what the
    code still draws with.

    The indentation is written here rather than derived from the anchor: the
    emitter owning the margin would mean it silently re-indents lines a person
    wrote, which is the class of thing this whole file exists to remove.
    """
    if entry.get("$type") != "dimension":
        return []
    if name.startswith("r") and name[1:].isdigit():
        return []
    if name == "full":
        return []  # a shape rule (Capsule), not a number
    px = entry["$value"].removesuffix("px")
    return [f"    static let {name}: CGFloat = {px}"]


DESTINATIONS = [
    kyber_tokens.Destination(CSS, css_declarations, css_pattern, label="globals.css"),
    kyber_tokens.Destination(SWIFT, swift_declarations(SWIFT, "Color.hex"),
                              swift_pattern("Color.hex"), label="Theme.swift"),
    kyber_tokens.Destination(WIDGET, swift_declarations(WIDGET, "Color.widgetHex"),
                              swift_pattern("Color.widgetHex"), label="WidgetTheme.swift"),
    kyber_tokens.Block(SWIFT, radius_declarations,
                       "// kyber:radius start", "// kyber:radius end",
                       label="Theme.swift (radios)"),
]

# The colour path walks `color`; the radius block walks `radius`. One pass over
# both, so a mismatch anywhere is one report and one exit code.
GROUPS = ["color", "radius"]


def coverage() -> list[str]:
    """Values the code uses that the token file does not sanction.

    The colour check compares declarations; this one cannot, because type,
    radius and spacing are written inline across the components. So it asks the
    other question — is anything in the code off-scale — which is what actually
    erodes a system: not a token changing, but a one-off slipping in beside it.
    """
    sys.path.insert(0, str(ROOT))
    import usage

    off = []
    def check(label, pairs, allowed, floor=8):
        for value, uses in pairs:
            if uses >= floor and f"{value:g}px" not in allowed:
                off.append(f"{label} {value:g}px ({uses} usos) no está en tokens.json")

    type_px = {e["$value"] for k, e in TOKENS.get("type", {}).items() if isinstance(e, dict)}
    web = [(s_, sum(w.values())) for s_, w in usage.type_steps()]
    ios = [(s_, sum(w.values())) for s_, w in usage.ios_type_steps()]
    check("type web", web, type_px)
    check("type iOS", ios, type_px)

    radius_px = {e["$value"] for k, e in TOKENS.get("radius", {}).items() if isinstance(e, dict)}
    check("radius web", usage.radii(), radius_px)
    check("radius iOS", usage.ios_radii(), radius_px)

    sp = TOKENS.get("spacing", {})
    check("padding", usage.padding_x(),
          {e["$value"] for e in sp.get("padding", {}).values()})
    check("gap", usage.gaps(), {e["$value"] for e in sp.get("gap", {}).values()})
    return off


def verify() -> int:
    code = kyber_tokens.verify(TOKENS, DESTINATIONS, GROUPS)
    if code != 0:
        return code
    off = coverage()
    if off:
        print(f"\n  {len(off)} valores fuera de escala:")
        for o in off:
            print(f"    · {o}")
        return 1
    print("  y ningún tamaño, radio o espaciado de uso frecuente queda fuera de la escala")
    return 0


def main() -> int:
    args = sys.argv[1:]
    known = {"--write", "--verify", "--help", "-h"}
    unknown = [a for a in args if a not in known]
    usage_line = "uso: emit.py [--verify | --write]"
    if unknown:
        print(f"no entiendo {' '.join(unknown)}.\n{usage_line}", file=sys.stderr)
        return 1
    if "--help" in args or "-h" in args:
        print(usage_line)
        return 0
    if "--write" in args:
        return kyber_tokens.write(TOKENS, DESTINATIONS, GROUPS)
    if "--verify" in args:
        return verify()
    return kyber_tokens.show(TOKENS, DESTINATIONS, GROUPS)


if __name__ == "__main__":
    sys.exit(main())
